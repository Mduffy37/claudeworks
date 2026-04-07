"""
Profile assembly and management for Claude Code.

Uses CLAUDE_CONFIG_DIR to create isolated config directories with
symlinked plugins, filtered registries, and shared credentials.
"""

import hashlib
import json
import os
import subprocess
import shutil
from pathlib import Path
from dataclasses import dataclass, field


CLAUDE_HOME = Path.home() / ".claude"
PROFILES_DIR = Path.home() / ".claude-profiles"


@dataclass
class PluginEntry:
    """A single installed plugin from installed_plugins.json."""
    name: str  # e.g. "superpowers@claude-plugins-official"
    scope: str  # "user" or "project"
    install_path: str
    version: str
    marketplace: str  # e.g. "claude-plugins-official"
    plugin_name: str  # e.g. "superpowers"
    project_path: str | None = None

    @property
    def cache_rel_path(self) -> str:
        """Relative path within plugins/cache/."""
        # e.g. "claude-plugins-official/superpowers/5.0.6"
        parts = Path(self.install_path).parts
        cache_idx = parts.index("cache")
        return str(Path(*parts[cache_idx + 1:]))


@dataclass
class PluginItem:
    """An individual skill, agent, or command within a plugin."""
    name: str
    type: str  # "skill", "agent", "command"
    plugin: str  # parent plugin name
    path: str  # path to the .md file
    user_invocable: bool = True


@dataclass
class Profile:
    """A named Claude Code profile."""
    name: str
    plugins: list[str] = field(default_factory=list)  # plugin names to include
    directory: str | None = None  # default working directory
    description: str = ""

    @property
    def config_dir(self) -> Path:
        return PROFILES_DIR / self.name / "config"

    @property
    def keychain_service(self) -> str:
        h = hashlib.sha256(str(self.config_dir).encode()).hexdigest()[:8]
        return f"Claude Code-credentials-{h}"


def scan_installed_plugins() -> list[PluginEntry]:
    """Read installed_plugins.json and return all registered plugins."""
    manifest_path = CLAUDE_HOME / "plugins" / "installed_plugins.json"
    if not manifest_path.exists():
        return []

    with open(manifest_path) as f:
        data = json.load(f)

    entries = []
    for name, installs in data.get("plugins", {}).items():
        parts = name.split("@", 1)
        plugin_name = parts[0]
        marketplace = parts[1] if len(parts) > 1 else "unknown"

        for install in installs:
            entries.append(PluginEntry(
                name=name,
                scope=install.get("scope", "user"),
                install_path=install.get("installPath", ""),
                version=install.get("version", "unknown"),
                marketplace=marketplace,
                plugin_name=plugin_name,
                project_path=install.get("projectPath"),
            ))
    return entries


def scan_plugin_items(plugin: PluginEntry) -> list[PluginItem]:
    """Scan a plugin directory for individual skills, agents, and commands."""
    items = []
    base = Path(plugin.install_path)
    if not base.exists():
        return items

    # Skills
    for skill_dir in (base / "skills").glob("*/"):
        skill_md = skill_dir / "SKILL.md"
        if skill_md.exists():
            frontmatter = _read_frontmatter(skill_md)
            invocable = frontmatter.get("user-invocable", "true").lower() != "false"
            items.append(PluginItem(
                name=frontmatter.get("name", skill_dir.name),
                type="skill",
                plugin=plugin.name,
                path=str(skill_md),
                user_invocable=invocable,
            ))

    # Commands
    for cmd_file in (base / "commands").glob("*.md"):
        items.append(PluginItem(
            name=cmd_file.stem,
            type="command",
            plugin=plugin.name,
            path=str(cmd_file),
        ))

    # Agents
    for agent_file in (base / "agents").glob("*.md"):
        if agent_file.name == "README.md":
            continue
        items.append(PluginItem(
            name=agent_file.stem,
            type="agent",
            plugin=plugin.name,
            path=str(agent_file),
        ))

    return items


def assemble_profile(profile: Profile) -> Path:
    """
    Build a profile's config directory with symlinked plugins.

    Returns the config directory path.
    """
    config_dir = profile.config_dir

    # Create directory structure
    for subdir in ["plugins/cache", "plugins/data", "plugins/marketplaces"]:
        (config_dir / subdir).mkdir(parents=True, exist_ok=True)

    # Read source installed_plugins.json
    source_manifest = CLAUDE_HOME / "plugins" / "installed_plugins.json"
    if not source_manifest.exists():
        raise FileNotFoundError("No installed_plugins.json found")

    with open(source_manifest) as f:
        manifest = json.load(f)

    # Filter to only selected plugins — keep original absolute installPaths
    # Claude resolves paths regardless of CLAUDE_CONFIG_DIR
    filtered_plugins = {
        name: entries
        for name, entries in manifest.get("plugins", {}).items()
        if name in profile.plugins
    }

    # Write filtered installed_plugins.json
    profile_manifest = {
        "version": manifest.get("version", 2),
        "plugins": filtered_plugins,
    }
    with open(config_dir / "plugins" / "installed_plugins.json", "w") as f:
        json.dump(profile_manifest, f, indent=2)

    # Build settings.json — read source but only keep safe keys
    # extraKnownMarketplaces and effortLevel can interfere with plugin loading
    source_settings = CLAUDE_HOME / "settings.json"
    if source_settings.exists():
        with open(source_settings) as f:
            source = json.load(f)
    else:
        source = {}

    SAFE_KEYS = {"env", "hooks", "statusLine", "voiceEnabled"}
    settings = {k: v for k, v in source.items() if k in SAFE_KEYS}
    settings["enabledPlugins"] = {name: True for name in profile.plugins}

    # Copy permissions — keep plugin MCP permissions, strip standalone MCP permissions
    source_perms = source.get("permissions", {})
    if source_perms:
        allowed = source_perms.get("allow", [])
        settings["permissions"] = {
            **source_perms,
            "allow": [t for t in allowed if not t.startswith("mcp__") or t.startswith("mcp__plugin_")],
        }

    settings_path = config_dir / "settings.json"
    with open(settings_path, "w") as f:
        json.dump(settings, f, indent=2)
        f.write("\n")

    # Symlink plugin cache directories — Claude checks these exist even though
    # installed_plugins.json has absolute paths
    _symlink_selected_caches(profile, config_dir)

    # Symlink shared resources
    _symlink_shared(config_dir)

    return config_dir


def _symlink_selected_caches(profile: Profile, config_dir: Path):
    """Symlink only the selected plugins' cache directories."""
    source_cache = CLAUDE_HOME / "plugins" / "cache"
    target_cache = config_dir / "plugins" / "cache"

    # Clear existing symlinks
    for existing in target_cache.iterdir():
        if existing.is_symlink():
            existing.unlink()

    # Determine which marketplace dirs need symlinking
    needed_marketplaces = set()
    plugins = scan_installed_plugins()
    for plugin in plugins:
        if plugin.name in profile.plugins:
            needed_marketplaces.add(plugin.marketplace)

    # Symlink entire marketplace directories (contains the plugin subdirs)
    for marketplace in needed_marketplaces:
        source = source_cache / marketplace
        target = target_cache / marketplace
        if source.exists() and not target.exists():
            target.symlink_to(source)


def _symlink_shared(config_dir: Path):
    """Symlink shared resources from ~/.claude/ into the profile."""
    shared = [
        ("CLAUDE.md", "CLAUDE.md"),
        ("projects", "projects"),
    ]

    for source_name, target_name in shared:
        source = CLAUDE_HOME / source_name
        target = config_dir / target_name
        if source.exists() and not target.exists():
            target.symlink_to(source)

    # Symlink plugin state files
    for state_file in ["known_marketplaces.json", "blocklist.json", "install-counts-cache.json"]:
        source = CLAUDE_HOME / "plugins" / state_file
        target = config_dir / "plugins" / state_file
        if source.exists():
            if target.exists() or target.is_symlink():
                target.unlink()
            target.symlink_to(source)

    # Symlink all marketplaces
    source_mp = CLAUDE_HOME / "plugins" / "marketplaces"
    target_mp = config_dir / "plugins" / "marketplaces"
    if source_mp.exists():
        for mp in source_mp.iterdir():
            target = target_mp / mp.name
            if not target.exists():
                target.symlink_to(mp)

    # Symlink all data entries
    source_data = CLAUDE_HOME / "plugins" / "data"
    target_data = config_dir / "plugins" / "data"
    if source_data.exists():
        for entry in source_data.iterdir():
            target = target_data / entry.name
            if not target.exists():
                target.symlink_to(entry)


def copy_credentials(profile: Profile) -> bool:
    """Copy keychain credentials from default to profile's keychain entry."""
    username = os.environ.get("USER", "unknown")

    # Read default credentials
    try:
        result = subprocess.run(
            ["security", "find-generic-password", "-s", "Claude Code-credentials",
             "-a", username, "-w"],
            capture_output=True, text=True, check=True,
        )
        cred = result.stdout.strip()
    except subprocess.CalledProcessError:
        return False

    # Write to profile's keychain entry
    service = profile.keychain_service
    try:
        # Delete existing if present
        subprocess.run(
            ["security", "delete-generic-password", "-s", service, "-a", username],
            capture_output=True, check=False,
        )
        # Add new
        subprocess.run(
            ["security", "add-generic-password", "-s", service, "-a", username,
             "-w", cred],
            capture_output=True, check=True,
        )
        return True
    except subprocess.CalledProcessError:
        return False


def launch_profile(profile: Profile, directory: str | None = None):
    """Launch Claude Code with this profile in iTerm2."""
    config_dir = profile.config_dir
    work_dir = directory or profile.directory or str(Path.home())

    # AppleScript to open new iTerm2 tab and launch claude
    script = f'''
    tell application "iTerm2"
        tell current window
            create tab with default profile
            tell current session
                write text "cd {work_dir} && CLAUDE_CONFIG_DIR={config_dir} claude"
            end tell
        end tell
    end tell
    '''

    subprocess.run(["osascript", "-e", script], check=True)


def _read_frontmatter(path: Path) -> dict:
    """Read YAML-like frontmatter from a markdown file."""
    result = {}
    with open(path) as f:
        lines = f.readlines()

    if not lines or lines[0].strip() != "---":
        return result

    for line in lines[1:]:
        if line.strip() == "---":
            break
        if ":" in line:
            key, _, value = line.partition(":")
            result[key.strip()] = value.strip()

    return result
