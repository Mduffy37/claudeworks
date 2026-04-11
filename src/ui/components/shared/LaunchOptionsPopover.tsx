import React, { useState, useEffect, useRef } from "react";
import type { LaunchOptions } from "../../../electron/types";

interface Props {
  defaultDangerous?: boolean;
  onLaunch: (options: LaunchOptions) => void;
  onClose: () => void;
}

export function LaunchOptionsPopover({ defaultDangerous, onLaunch, onClose }: Props) {
  const [terminalApp, setTerminalApp] = useState("iterm2");
  const [tmuxMode, setTmuxMode] = useState<"cc" | "plain" | "none">("cc");
  const [customFlags, setCustomFlags] = useState("");
  const [dangerous, setDangerous] = useState(defaultDangerous ?? false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    window.api.getGlobalDefaults().then((d) => {
      if (d.terminalApp) setTerminalApp(d.terminalApp);
      if (d.tmuxMode) setTmuxMode(d.tmuxMode as "cc" | "plain" | "none");
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
      <div className="launch-popover" ref={popoverRef}>
        <div className="launch-popover-title">Launch Settings</div>

        <div className="launch-popover-field">
          <label>Terminal</label>
          <select value={terminalApp} onChange={(e) => setTerminalApp(e.target.value)}>
            <option value="iterm2">iTerm2</option>
          </select>
        </div>

        <div className="launch-popover-field">
          <label>tmux Mode</label>
          <select value={tmuxMode} onChange={(e) => setTmuxMode(e.target.value as any)}>
            <option value="cc">-CC (iTerm integration)</option>
            <option value="plain">Plain tmux</option>
            <option value="none">No tmux</option>
          </select>
        </div>

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
