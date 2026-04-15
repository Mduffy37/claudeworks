import React, { useState, useEffect, useLayoutEffect, useRef } from "react";
import type { LaunchOptions } from "../../../electron/types";

interface Props {
  defaultDangerous?: boolean;
  showTmux?: boolean;
  onLaunch: (options: LaunchOptions) => void;
  onClose: () => void;
}

const POPOVER_MARGIN = 12;

export function LaunchOptionsPopover({ defaultDangerous, showTmux = true, onLaunch, onClose }: Props) {
  const [terminalApp, setTerminalApp] = useState("iterm2");
  const [tmuxMode, setTmuxMode] = useState<"cc" | "plain" | "none">("cc");
  const [customFlags, setCustomFlags] = useState("");
  const [dangerous, setDangerous] = useState(defaultDangerous ?? false);
  const [tmuxInstalled, setTmuxInstalled] = useState(true);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; arrowLeft: number } | null>(null);

  useLayoutEffect(() => {
    const updatePos = () => {
      const el = popoverRef.current;
      if (!el) return;
      const anchor = el.parentElement?.querySelector<HTMLElement>(".btn-launch-settings");
      if (!anchor) return;
      const anchorRect = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const popRect = el.getBoundingClientRect();
      const popW = popRect.width || el.offsetWidth || 300;
      const popH = popRect.height || el.offsetHeight || 300;
      const idealLeft = anchorRect.right - popW;
      const left = Math.min(Math.max(POPOVER_MARGIN, idealLeft), vw - popW - POPOVER_MARGIN);
      let top = anchorRect.bottom + 10;
      if (top + popH > vh - POPOVER_MARGIN) {
        top = Math.max(POPOVER_MARGIN, anchorRect.top - popH - 10);
      }
      const anchorCenter = anchorRect.left + anchorRect.width / 2;
      const arrowLeft = Math.min(Math.max(12, anchorCenter - left), popW - 12);
      setPos({ top, left, arrowLeft });
    };
    updatePos();
    window.addEventListener("resize", updatePos);
    window.addEventListener("scroll", updatePos, true);
    return () => {
      window.removeEventListener("resize", updatePos);
      window.removeEventListener("scroll", updatePos, true);
    };
  }, []);

  useEffect(() => {
    Promise.all([
      window.api.getGlobalDefaults(),
      window.api.checkTmuxInstalled(),
    ]).then(([d, hasTmux]) => {
      setTmuxInstalled(hasTmux);
      if (!hasTmux) {
        setTmuxMode("none");
      } else {
        if (d.tmuxMode) setTmuxMode(d.tmuxMode as "cc" | "plain" | "none");
      }
      if (d.terminalApp) setTerminalApp(d.terminalApp);
    });
  }, []);

  const handleLaunch = () => {
    onLaunch({
      terminalApp,
      tmuxMode,
      customFlags: customFlags.trim() || undefined,
      dangerouslySkipPermissions: dangerous || undefined,
    });
  };

  return (
    <>
      <div className="launch-popover-backdrop" onClick={onClose} />
      <div
        className="launch-popover"
        ref={popoverRef}
        style={pos ? { top: pos.top, left: pos.left, right: "auto", visibility: "visible", ["--popover-arrow-left" as any]: `${pos.arrowLeft}px` } : { visibility: "hidden" }}
      >
        <div className="launch-popover-title">Launch Settings</div>

        <div className="launch-popover-field">
          <label>Terminal</label>
          <select value={terminalApp} onChange={(e) => {
            setTerminalApp(e.target.value);
            if (e.target.value !== "iterm2" && tmuxMode === "cc") setTmuxMode("plain");
          }}>
            <option value="iterm2">iTerm2</option>
            <option value="terminal">Terminal.app</option>
          </select>
        </div>

        {showTmux && (
          <div className="launch-popover-field">
            <label>tmux Mode</label>
            {tmuxInstalled ? (
              <select value={tmuxMode} onChange={(e) => setTmuxMode(e.target.value as any)}>
                {terminalApp === "iterm2" && <option value="cc">-CC (iTerm integration)</option>}
                <option value="plain">Plain tmux</option>
                <option value="none">No tmux</option>
              </select>
            ) : (
              <div className="launch-popover-hint" style={{ margin: 0, padding: "5px 0" }}>
                tmux not installed — defaulting to no tmux
              </div>
            )}
          </div>
        )}

        <div className="launch-popover-field">
          <label>Custom Flags</label>
          <input
            type="text"
            value={customFlags}
            onChange={(e) => setCustomFlags(e.target.value)}
            placeholder="e.g. --max-turns 5"
          />
        </div>

        <label className="launch-popover-checkbox">
          <input
            type="checkbox"
            checked={dangerous}
            onChange={(e) => setDangerous(e.target.checked)}
          />
          <span>Dangerous mode</span>
          <span className="launch-popover-hint">--dangerously-skip-permissions</span>
        </label>

        <div className="launch-popover-actions">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-launch" onClick={handleLaunch}>
            <span className="btn-launch-icon">
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <path d="M3 7h8M8 4l3 3-3 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            Launch
          </button>
        </div>
      </div>
    </>
  );
}
