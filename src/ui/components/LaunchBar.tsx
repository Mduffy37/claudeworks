import React, { useState } from "react";

interface Props {
  profileName: string | null;
  defaultDirectory?: string;
  onLaunch: (directory?: string) => void;
}

function FolderIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path
        d="M1 3.5C1 2.67 1.67 2 2.5 2H5l1 1.5H10.5c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5h-8C1.67 11.5 1 10.83 1 10V3.5Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function LaunchBar({ profileName, defaultDirectory, onLaunch }: Props) {
  const [dirOverride, setDirOverride] = useState("");
  const [launching, setLaunching] = useState(false);

  const handleLaunch = async () => {
    if (!profileName) return;
    setLaunching(true);
    try {
      await onLaunch(dirOverride || undefined);
    } finally {
      setLaunching(false);
    }
  };

  const handleBrowse = async () => {
    const dir = await window.api.selectDirectory();
    if (dir) setDirOverride(dir);
  };

  return (
    <div className="launch-bar">
      <div className="launch-dir">
        <span className="launch-dir-icon">
          <FolderIcon />
        </span>
        <input
          type="text"
          placeholder={defaultDirectory || "Working directory (optional override)"}
          value={dirOverride}
          onChange={(e) => setDirOverride(e.target.value)}
          aria-label="Working directory override"
        />
        <button className="btn-secondary" onClick={handleBrowse}>
          Browse
        </button>
      </div>

      <button
        className={`btn-launch${launching ? " launching" : ""}`}
        disabled={!profileName || launching}
        onClick={handleLaunch}
        aria-label="Launch profile in iTerm2"
      >
        <span className="btn-launch-icon">
          {launching ? (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" style={{ animation: "spin 1s linear infinite" }}>
              <circle cx="7" cy="7" r="5.5" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
              <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path
                d="M3 7h8M8 4l3 3-3 3"
                stroke="white"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </span>
        {launching ? "Launching…" : "Launch in iTerm2"}
      </button>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
