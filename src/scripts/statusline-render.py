#!/usr/bin/env python3
"""
Claude Code status line renderer.

Reads session state on stdin (Claude Code's standard statusLine contract),
renders a single status line to stdout driven by a JSON config file
(~/.claude/statusline-config.json). v2 schema: a flat list of widgets
with `{"id": "break"}` sentinel entries marking section boundaries.
Within a section widgets are joined by the field separator; sections
themselves are joined by the section separator. v1 configs (nested
`sections`) are migrated on read. Falls back to default_config() when
no config file is present. Replaces the previous hand-written
~/.claude/statusline.sh, which now thin-wraps this script.
"""

import importlib.util
import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

# MC blue palette — matches the original bash statusline.sh
CB = "\033[1;38;2;108;171;221m"
GREEN = "\033[1;38;2;80;200;120m"
RED_SOFT = "\033[1;38;2;200;100;100m"
RESET = "\033[0m"
# Default separators — can be overridden per-config via config.separators.
# SEP / SECTION are kept as module constants for backward compatibility
# (anything that imports them still gets the original glyphs).
SEP = f"{CB} │ {RESET}"
SECTION = f"{CB} ║ {RESET}"

# Bar style variants for the context widget. First char is "filled",
# second is "empty". The Python renderer picks based on opts["barStyle"].
BAR_STYLES = {
    "block": ("█", "░"),
    "heavy": ("━", "╌"),
    "light": ("─", "·"),
    "dots":  ("●", "○"),
}


def hex_to_ansi(hex_color) -> str:
    """Convert '#RRGGBB' to an ANSI 24-bit foreground escape. Falls back to CB on invalid input."""
    if not hex_color or not isinstance(hex_color, str):
        return CB
    h = hex_color.lstrip("#")
    if len(h) != 6:
        return CB
    try:
        r = int(h[0:2], 16)
        g = int(h[2:4], 16)
        b = int(h[4:6], 16)
    except ValueError:
        return CB
    return f"\033[1;38;2;{r};{g};{b}m"

# Risk-tier gradient (from the usage-statusline work; preserved here)
RISK_SAFE = "\033[1;38;2;80;200;120m"
RISK_OK = "\033[1;38;2;150;200;100m"
RISK_WARN = "\033[1;38;2;220;190;70m"
RISK_DANGER = "\033[1;38;2;230;140;60m"
RISK_CRITICAL = "\033[1;38;2;220;50;50m"

# USD → GBP / EUR FX rates. Refresh periodically; currency is Phase 4's
# options surface, but Phase 0 keeps these as constants for grep-ability.
# Rates as of 2026-04-14.
USD_TO_GBP = 0.79
USD_TO_EUR = 0.92

CONFIG_PATH = Path.home() / ".claude" / "statusline-config.json"


def default_config() -> dict:
    """Return the built-in default config. v2 schema: a flat widget list
    with just the model name. Users opt into more via the Status Bar tab
    in the claude-profiles app (presets, manual add)."""
    return {
        "version": 2,
        "separators": {"field": "│", "section": "║"},
        "widgets": [
            {"id": "model", "enabled": True, "options": {}},
        ],
    }


def _migrate_v1(data: dict) -> dict:
    """Convert a v1 config (nested `sections`) into a v2 flat widget list
    with implicit `break` sentinels between sections."""
    flat: list[dict] = []
    for i, section in enumerate(data.get("sections", [])):
        if i > 0:
            flat.append({"id": "break", "enabled": True, "options": {}})
        flat.extend(section.get("widgets", []) or [])
    return {
        "version": 2,
        "separators": data.get("separators"),
        "widgets": flat,
    }


def load_config() -> dict:
    """
    Lookup order:
      1. CLAUDE_STATUSLINE_CONFIG_OVERRIDE env var (used by Electron preview handler)
      2. $CLAUDE_CONFIG_DIR/statusline-config.json (per-profile override, Phase 6)
      3. ~/.claude/statusline-config.json (global)
      4. default_config()

    Handles both v1 (with `sections`) and v2 (with `widgets`) shapes —
    v1 is migrated on read.
    """
    candidates: list[Path] = []
    override = os.environ.get("CLAUDE_STATUSLINE_CONFIG_OVERRIDE")
    if override:
        candidates.append(Path(override))
    cfg_dir = os.environ.get("CLAUDE_CONFIG_DIR")
    if cfg_dir:
        candidates.append(Path(cfg_dir) / "statusline-config.json")
    candidates.append(CONFIG_PATH)

    for candidate in candidates:
        if not candidate.exists():
            continue
        try:
            data = json.loads(candidate.read_text())
        except Exception:
            continue
        if not isinstance(data, dict):
            continue
        if "widgets" in data and isinstance(data.get("widgets"), list):
            return data
        if "sections" in data and isinstance(data.get("sections"), list):
            return _migrate_v1(data)
    return default_config()


def is_ssh_session() -> bool:
    """True if this status line is running inside an SSH session."""
    return bool(os.environ.get("SSH_CONNECTION") or os.environ.get("SSH_TTY"))


# --- Dynamic import of the usage helper (no package structure) ---
# Runs at module-load time, so any failure here must be swallowed or the
# entire status line script fails to load and Claude Code users see a
# traceback. On failure we null out the helpers and the usage widgets
# short-circuit to None.
_USL_PATH = Path.home() / ".claude" / "scripts" / "usage-statusline.py"
try:
    _spec = importlib.util.spec_from_file_location("usl", _USL_PATH)
    if _spec is None or _spec.loader is None:
        # spec_from_file_location returns None when the file is missing;
        # raising here funnels into the except below for a uniform null path.
        raise ImportError(f"cannot load spec for {_USL_PATH}")
    _usl = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_usl)
    cached_usage = _usl.cached_usage
    fmt_reset = _usl.fmt_reset
    derive_service = _usl.derive_service
    risk_tier = _usl.risk_tier
except Exception:
    cached_usage = None
    fmt_reset = None
    derive_service = None
    risk_tier = None

_usage_cache_for_run: dict | None = None


def _is_preview() -> bool:
    """True when running in Electron's status bar preview mode."""
    return bool(os.environ.get("CLAUDE_STATUSLINE_CONFIG_OVERRIDE"))


def _get_usage() -> dict | None:
    global _usage_cache_for_run
    if cached_usage is None or derive_service is None:
        return None
    if _usage_cache_for_run is not None:
        return _usage_cache_for_run
    _usage_cache_for_run = cached_usage(derive_service())
    return _usage_cache_for_run


# ---------- Widgets ----------


def _icon_prefix(opts: dict) -> str:
    """Shared helper: returns the user-configured icon plus trailing space, or ''."""
    icon = (opts.get("icon") or "").strip()
    return f"{icon} " if icon else ""


def render_time(session: dict, options: dict | None = None) -> str | None:
    """Wall-clock time. Honors color, icon, format (12h/24h), showSeconds."""
    opts = options or {}
    color = hex_to_ansi(opts.get("color"))
    prefix = _icon_prefix(opts)
    fmt = opts.get("format", "24h")
    show_seconds = opts.get("showSeconds", False)

    if fmt == "12h":
        pattern = "%-I:%M:%S %p" if show_seconds else "%-I:%M %p"
    else:
        pattern = "%H:%M:%S" if show_seconds else "%H:%M"

    now = datetime.now().strftime(pattern)
    return f"{color}{prefix}{now}{RESET}"


def render_model(session: dict, options: dict | None = None) -> str | None:
    """Model display name, prefixed by 'Claude '. Returns None if no model."""
    opts = options or {}
    color = hex_to_ansi(opts.get("color"))
    prefix = _icon_prefix(opts)
    model = (session.get("model") or {}).get("display_name")
    if not model:
        return None
    return f"{color}{prefix}Claude {model}{RESET}"


def render_context(session: dict, options: dict | None = None) -> str | None:
    opts = options or {}
    color = hex_to_ansi(opts.get("color"))
    prefix = _icon_prefix(opts)
    show_bar = opts.get("showBar", True)
    bar_width = int(opts.get("barWidth", 15))
    bar_style = opts.get("barStyle", "block")
    filled_char, empty_char = BAR_STYLES.get(bar_style, BAR_STYLES["block"])

    cw = session.get("context_window") or {}
    pct = cw.get("used_percentage")
    if pct is None:
        total = cw.get("context_window_size") or 0
        cu = cw.get("current_usage") or {}
        used = (
            (cu.get("input_tokens") or 0)
            + (cu.get("cache_creation_input_tokens") or 0)
            + (cu.get("cache_read_input_tokens") or 0)
        )
        if not total:
            return None
        pct = used / total * 100

    pct_int = int(pct)
    # Red-at-80% is a semantic warning, NOT a primary color — preserve it.
    bar_color = RISK_CRITICAL if pct_int >= 80 else color

    if not show_bar or is_ssh_session():
        return f"{bar_color}{prefix}{pct_int}%{RESET}"

    filled = pct_int * bar_width // 100
    empty = bar_width - filled
    filled_str = filled_char * filled
    empty_str = empty_char * empty
    return f"{color}{prefix}Context: {bar_color}{filled_str}{color}{empty_str}{RESET} {bar_color}{pct_int}%{RESET}"


def render_git(session: dict, options: dict | None = None) -> str | None:
    opts = options or {}
    color = hex_to_ansi(opts.get("color"))
    prefix = _icon_prefix(opts)
    show_unpushed = opts.get("showUnpushed", True)
    show_dirty = opts.get("showDirty", True)

    try:
        branch = subprocess.check_output(
            ["git", "branch", "--show-current"],
            stderr=subprocess.DEVNULL, text=True,
        ).strip()
    except Exception:
        return None
    if not branch:
        return None

    dirty = 0
    if show_dirty:
        try:
            dirty_out = subprocess.check_output(
                ["git", "status", "--porcelain"],
                stderr=subprocess.DEVNULL, text=True,
            )
            dirty = len([l for l in dirty_out.splitlines() if l.strip()])
        except Exception:
            dirty = 0

    unpushed = 0
    if show_unpushed:
        try:
            unpushed_out = subprocess.check_output(
                ["git", "rev-list", "--count", "@{u}..HEAD"],
                stderr=subprocess.DEVNULL, text=True,
            )
            unpushed = int(unpushed_out.strip() or "0")
        except Exception:
            unpushed = 0

    parts = [f"{color}{prefix}{branch}{RESET}"]
    if show_unpushed and unpushed > 0:
        parts.append(f"{color}({unpushed}↑){RESET}")
    if show_dirty and dirty > 0:
        if dirty <= 3:
            dirty_color = "\033[1;38;2;180;120;120m"
        elif dirty <= 7:
            dirty_color = "\033[1;38;2;200;80;80m"
        elif dirty <= 12:
            dirty_color = "\033[1;38;2;220;50;50m"
        else:
            dirty_color = "\033[1;38;2;255;30;30m"
        parts.append(f"{dirty_color}({dirty}±){RESET}")

    return " ".join(parts)


def render_lines(session: dict, options: dict | None = None) -> str | None:
    # `lines` deliberately has NO color option — its green/red semantics
    # are load-bearing (added vs removed). Icon prefix is still honored
    # and placed before the `+count` block.
    opts = options or {}
    prefix = _icon_prefix(opts)
    cost = session.get("cost") or {}
    added = cost.get("total_lines_added") or 0
    removed = cost.get("total_lines_removed") or 0
    if added == 0 and removed == 0:
        return None
    prefix_block = f"{CB}{prefix}{RESET}" if prefix else ""
    return f"{prefix_block}{GREEN}+{added}{RESET} {RED_SOFT}-{removed}{RESET}"


def render_uptime(session: dict, options: dict | None = None) -> str | None:
    opts = options or {}
    color = hex_to_ansi(opts.get("color"))
    prefix = _icon_prefix(opts)
    cost = session.get("cost") or {}
    duration_ms = cost.get("total_duration_ms") or 0
    if not duration_ms:
        return None
    total_secs = duration_ms // 1000
    hours = total_secs // 3600
    mins = (total_secs % 3600) // 60
    secs = total_secs % 60
    if hours > 0:
        text = f"{hours}h {mins}m"
    elif mins > 0:
        text = f"{mins}m {secs}s"
    else:
        text = f"{secs}s"
    return f"{color}{prefix}{text}{RESET}"


def render_cost(session: dict, options: dict | None = None) -> str | None:
    opts = options or {}
    color = hex_to_ansi(opts.get("color"))
    prefix = _icon_prefix(opts)
    cost = session.get("cost") or {}
    cost_usd = cost.get("total_cost_usd") or 0
    if not cost_usd:
        return None
    currency = opts.get("currency", "GBP")
    if currency == "USD":
        return f"{color}{prefix}${cost_usd:.2f}{RESET}"
    elif currency == "EUR":
        return f"{color}{prefix}€{cost_usd * USD_TO_EUR:.2f}{RESET}"
    else:
        return f"{color}{prefix}£{cost_usd * USD_TO_GBP:.2f}{RESET}"


def render_usage_5h(session: dict, options: dict | None = None) -> str | None:
    usage = _get_usage()
    if not usage:
        if _is_preview():
            opts = options or {}
            color = hex_to_ansi(opts.get("color"))
            prefix = _icon_prefix(opts)
            return f"{color}{prefix}5H: --% (--:--){RESET}"
        return None
    bucket = usage.get("five_hour") or {}
    util = bucket.get("utilization")
    if util is None:
        if _is_preview():
            opts = options or {}
            color = hex_to_ansi(opts.get("color"))
            prefix = _icon_prefix(opts)
            return f"{color}{prefix}5H: --% (--:--){RESET}"
        return None
    opts = options or {}
    show_reset = opts.get("showReset", True)
    show_tier = opts.get("showTier", True)
    user_color = hex_to_ansi(opts.get("color"))
    prefix = _icon_prefix(opts)

    reset_str = fmt_reset(bucket.get("resets_at")) if show_reset else ""
    text = f"5H: {util:.0f}% ({reset_str})" if reset_str else f"5H: {util:.0f}%"

    # Priority: tier color (if enabled) > user color > CB fallback (baked
    # into hex_to_ansi). The risk gradient is semantically meaningful, so
    # we only let the user override it when they explicitly turn tiering
    # off.
    if show_tier:
        tier = risk_tier(util, bucket.get("resets_at"), window_minutes=300)
        color = {
            "safe": RISK_SAFE,
            "ok": RISK_OK,
            "warn": RISK_WARN,
            "danger": RISK_DANGER,
            "critical": RISK_CRITICAL,
        }.get(tier, user_color)
    else:
        color = user_color

    return f"{color}{prefix}{text}{RESET}"


def render_usage_7d(session: dict, options: dict | None = None) -> str | None:
    usage = _get_usage()
    if not usage:
        if _is_preview():
            opts = options or {}
            color = hex_to_ansi(opts.get("color"))
            prefix = _icon_prefix(opts)
            return f"{color}{prefix}7D: --% (--:--){RESET}"
        return None
    bucket = usage.get("seven_day") or {}
    util = bucket.get("utilization")
    if util is None:
        if _is_preview():
            opts = options or {}
            color = hex_to_ansi(opts.get("color"))
            prefix = _icon_prefix(opts)
            return f"{color}{prefix}7D: --% (--:--){RESET}"
        return None
    opts = options or {}
    show_reset = opts.get("showReset", False)
    show_tier = opts.get("showTier", False)
    user_color = hex_to_ansi(opts.get("color"))
    prefix = _icon_prefix(opts)

    reset_str = fmt_reset(bucket.get("resets_at")) if show_reset else ""
    text = f"7D: {util:.0f}% ({reset_str})" if reset_str else f"7D: {util:.0f}%"

    if show_tier:
        # 7 days = 10080 minutes. Same risk-tier priority logic as 5h.
        tier = risk_tier(util, bucket.get("resets_at"), window_minutes=10080)
        color = {
            "safe": RISK_SAFE,
            "ok": RISK_OK,
            "warn": RISK_WARN,
            "danger": RISK_DANGER,
            "critical": RISK_CRITICAL,
        }.get(tier, user_color)
    else:
        color = user_color

    return f"{color}{prefix}{text}{RESET}"


def render_usage_7d_sonnet(session: dict, options: dict | None = None) -> str | None:
    usage = _get_usage()
    if not usage:
        if _is_preview():
            opts = options or {}
            color = hex_to_ansi(opts.get("color"))
            prefix = _icon_prefix(opts)
            return f"{color}{prefix}7D Sonnet: --% (--:--){RESET}"
        return None
    bucket = usage.get("seven_day_sonnet") or {}
    util = bucket.get("utilization")
    if util is None:
        if _is_preview():
            opts = options or {}
            color = hex_to_ansi(opts.get("color"))
            prefix = _icon_prefix(opts)
            return f"{color}{prefix}7D Sonnet: --% (--:--){RESET}"
        return None
    opts = options or {}
    show_reset = opts.get("showReset", False)
    show_tier = opts.get("showTier", False)
    user_color = hex_to_ansi(opts.get("color"))
    prefix = _icon_prefix(opts)

    reset_str = fmt_reset(bucket.get("resets_at")) if show_reset else ""
    text = f"7D Sonnet: {util:.0f}% ({reset_str})" if reset_str else f"7D Sonnet: {util:.0f}%"

    if show_tier:
        tier = risk_tier(util, bucket.get("resets_at"), window_minutes=10080)
        color = {
            "safe": RISK_SAFE,
            "ok": RISK_OK,
            "warn": RISK_WARN,
            "danger": RISK_DANGER,
            "critical": RISK_CRITICAL,
        }.get(tier, user_color)
    else:
        color = user_color

    return f"{color}{prefix}{text}{RESET}"


# ---------- Phase 7 widgets ----------


def render_cwd(session: dict, options: dict | None = None) -> str | None:
    """Current working directory. Shows either the basename (depth=1) or
    the last N path segments joined by '/'."""
    opts = options or {}
    color = hex_to_ansi(opts.get("color"))
    prefix = _icon_prefix(opts)
    try:
        depth = int(opts.get("depth", 1))
    except (TypeError, ValueError):
        depth = 1
    if depth < 1:
        depth = 1
    try:
        cwd = Path.cwd()
    except Exception:
        return None
    parts = cwd.parts
    if not parts:
        return None
    if depth >= len(parts):
        text = str(cwd)
    elif depth == 1:
        text = parts[-1]
    else:
        text = "/".join(parts[-depth:])
    return f"{color}{prefix}{text}{RESET}"


def render_git_age(session: dict, options: dict | None = None) -> str | None:
    """Relative time since the most recent commit on the current branch.
    Uses git's `%cr` format ('5 minutes ago', '3 days ago', etc.)."""
    opts = options or {}
    color = hex_to_ansi(opts.get("color"))
    prefix = _icon_prefix(opts)
    try:
        out = subprocess.check_output(
            ["git", "log", "-1", "--format=%cr"],
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=2,
        ).strip()
    except Exception:
        return None
    if not out:
        return None
    return f"{color}{prefix}{out}{RESET}"


_PROFILE_DIR_RE = re.compile(r"\.claude-profiles/([^/]+)/config")


def render_profile(session: dict, options: dict | None = None) -> str | None:
    """Name of the claude-profiles profile the current session runs under,
    inferred from the $CLAUDE_CONFIG_DIR path."""
    opts = options or {}
    color = hex_to_ansi(opts.get("color"))
    prefix = _icon_prefix(opts)
    cfg_dir = os.environ.get("CLAUDE_CONFIG_DIR", "")
    if not cfg_dir:
        return None
    match = _PROFILE_DIR_RE.search(cfg_dir)
    if not match:
        return None
    return f"{color}{prefix}{match.group(1)}{RESET}"


def render_plugins(session: dict, options: dict | None = None) -> str | None:
    """Number of plugins installed in the active profile's
    installed_plugins.json."""
    opts = options or {}
    color = hex_to_ansi(opts.get("color"))
    prefix = _icon_prefix(opts)
    cfg_dir = os.environ.get("CLAUDE_CONFIG_DIR", "")
    if not cfg_dir:
        return None
    plugins_path = Path(cfg_dir) / "plugins" / "installed_plugins.json"
    if not plugins_path.exists():
        return None
    try:
        data = json.loads(plugins_path.read_text())
        count = len(data.get("plugins", {}) or {})
    except Exception:
        return None
    return f"{color}{prefix}{count} plugins{RESET}"


def render_burn(session: dict, options: dict | None = None) -> str | None:
    """Cost burn rate: total cost divided by total duration, rendered
    as {currency}{rate}/min. Uses the same currency option as the cost
    widget (defaults to GBP)."""
    opts = options or {}
    color = hex_to_ansi(opts.get("color"))
    prefix = _icon_prefix(opts)
    cost = session.get("cost") or {}
    cost_usd = cost.get("total_cost_usd") or 0
    duration_ms = cost.get("total_duration_ms") or 0
    if cost_usd <= 0 or duration_ms <= 0:
        return None
    minutes = duration_ms / 60000
    if minutes <= 0:
        return None
    rate_usd = cost_usd / minutes
    currency = opts.get("currency", "GBP")
    if currency == "USD":
        text = f"${rate_usd:.3f}/min"
    elif currency == "EUR":
        text = f"€{rate_usd * USD_TO_EUR:.3f}/min"
    else:
        text = f"£{rate_usd * USD_TO_GBP:.3f}/min"
    return f"{color}{prefix}{text}{RESET}"


def render_limit_eta(session: dict, options: dict | None = None) -> str | None:
    """
    Project when the current rate limit bucket will hit 100% utilization at
    the current burn rate. Reuses _get_usage() from usage-statusline so no
    new caching infrastructure is needed. Color tier is derived from
    mins_to_full / remaining_min — NOT from risk_tier(), which projects
    end-of-window utilization and gives the wrong answer for an ETA whose
    projection lands after the window resets. Defaults to the 5h bucket;
    user can switch to 7d via options.
    """
    opts = options or {}
    user_color = hex_to_ansi(opts.get("color"))
    icon = opts.get("icon", "").strip()
    prefix = f"{icon} " if icon else ""
    show_tier = opts.get("showTier", True)
    bucket_choice = opts.get("bucket", "5h")

    usage = _get_usage()
    if not usage:
        if _is_preview():
            return f"{user_color}{prefix}~--m{RESET}"
        return None

    if bucket_choice == "7d":
        bucket_key = "seven_day"
        window_min = 10080  # 7 days = 10080 minutes
    else:
        bucket_key = "five_hour"
        window_min = 300  # 5 hours = 300 minutes

    bucket = usage.get(bucket_key) or {}
    util = bucket.get("utilization")
    resets_at = bucket.get("resets_at")
    if util is None or not resets_at:
        if _is_preview():
            return f"{user_color}{prefix}~--m{RESET}"
        return None
    if util <= 0 or util >= 100:
        if _is_preview():
            return f"{user_color}{prefix}~--m{RESET}"
        return None

    try:
        reset_dt = datetime.fromisoformat(resets_at.replace("Z", "+00:00"))
    except Exception:
        return None

    now = datetime.now(timezone.utc)
    remaining_min = (reset_dt - now).total_seconds() / 60
    elapsed_min = window_min - remaining_min

    # Grace period: need at least 5 minutes of elapsed time for a stable rate
    if elapsed_min < 5:
        if _is_preview():
            return f"{user_color}{prefix}~--m{RESET}"
        return None

    rate_per_min = util / elapsed_min
    if rate_per_min <= 0:
        if _is_preview():
            return f"{user_color}{prefix}~--m{RESET}"
        return None

    remaining_pct = 100 - util
    mins_to_full = remaining_pct / rate_per_min

    # Format as ~XhYYm or ~XXm — NO prefix
    if mins_to_full >= 60:
        h = int(mins_to_full // 60)
        m = int(mins_to_full % 60)
        text = f"~{h}h{m:02d}m"
    else:
        text = f"~{int(mins_to_full)}m"

    if show_tier:
        # Deliberately NOT using risk_tier() here: that function projects
        # end-of-window utilization, which is the right signal for the 5h
        # widget but wrong for an ETA. Here we compare mins_to_full to the
        # time remaining in the window — if the limit is projected to fall
        # after reset, there's no risk this window at all.
        if remaining_min <= 0:
            tier = "safe"
        else:
            ratio = mins_to_full / remaining_min
            if ratio >= 1.5:
                tier = "safe"
            elif ratio >= 1.0:
                tier = "ok"
            elif ratio >= 0.75:
                tier = "warn"
            elif ratio >= 0.5:
                tier = "danger"
            else:
                tier = "critical"
        color = {
            "safe": RISK_SAFE,
            "ok": RISK_OK,
            "warn": RISK_WARN,
            "danger": RISK_DANGER,
            "critical": RISK_CRITICAL,
        }.get(tier, user_color)
    else:
        color = user_color

    return f"{color}{prefix}{text}{RESET}"


# ---------- Layout ----------


WIDGETS = {
    "time": render_time,
    "model": render_model,
    "context": render_context,
    "git": render_git,
    "lines": render_lines,
    "uptime": render_uptime,
    "cost": render_cost,
    "usage5h": render_usage_5h,
    "usage7d": render_usage_7d,
    "usage7dSonnet": render_usage_7d_sonnet,
    # Phase 7:
    "cwd": render_cwd,
    "gitAge": render_git_age,
    "profile": render_profile,
    "plugins": render_plugins,
    "burn": render_burn,
    "limitEta": render_limit_eta,
}

def main() -> None:
    try:
        session_raw = sys.stdin.read()
        try:
            session = json.loads(session_raw) if session_raw.strip() else {}
        except Exception:
            session = {}

        config = load_config()

        # Resolve the master color once per render. Widgets without their own
        # `color` option inherit from master; if master is unset, widgets fall
        # back to hex_to_ansi's default (CB / MC blue).
        master_hex = config.get("masterColor")

        seps = config.get("separators") or {}
        field_sep = seps.get("field") or "│"
        section_sep = seps.get("section") or "║"

        # Separator colors: per-separator override → master → CB
        field_color_hex = seps.get("fieldColor") or master_hex
        section_color_hex = seps.get("sectionColor") or master_hex
        field_sep_color = hex_to_ansi(field_color_hex) if field_color_hex else CB
        section_sep_color = hex_to_ansi(section_color_hex) if section_color_hex else CB

        sep_str = f"{field_sep_color} {field_sep} {RESET}"
        section_str = f"{section_sep_color} {section_sep} {RESET}"

        widgets = config.get("widgets", []) or []
        groups: list[list[str]] = [[]]
        for widget in widgets:
            if not widget.get("enabled", True):
                continue
            widget_id = widget.get("id")
            if widget_id == "break":
                # Start a new section group. Empty groups are filtered
                # out below so consecutive breaks don't produce empty
                # sections.
                groups.append([])
                continue
            fn = WIDGETS.get(widget_id)
            if fn is None:
                continue

            # Inject master color into the widget's options if the widget
            # didn't set its own color. Widgets that already have `color`
            # keep their override.
            opts = widget.get("options") or {}
            if master_hex and not opts.get("color"):
                opts = {**opts, "color": master_hex}

            try:
                out = fn(session, opts)
            except Exception:
                out = None
            if out:
                groups[-1].append(out)

        rendered_groups = [sep_str.join(g) for g in groups if g]
        if rendered_groups:
            print(section_str.join(rendered_groups))
        else:
            print()
    except Exception:
        # Last-resort belt: absolutely no traceback should ever escape
        # into the Claude Code status line area.
        print()


if __name__ == "__main__":
    main()
