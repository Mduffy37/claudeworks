import React, { useState } from "react";

interface Props {
  profileName: string | null;
  defaultDirectory?: string;
  onLaunch: (directory?: string) => void;
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
        <input
          type="text"
          placeholder={defaultDirectory || "Working directory (optional)"}
          value={dirOverride}
          onChange={(e) => setDirOverride(e.target.value)}
        />
        <button className="btn-secondary" onClick={handleBrowse}>
          Browse
        </button>
      </div>
      <button
        className="btn-launch"
        disabled={!profileName || launching}
        onClick={handleLaunch}
      >
        {launching ? "Launching..." : "Launch in iTerm2"}
      </button>
    </div>
  );
}
