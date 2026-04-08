import React from "react";
import type { Profile } from "../../../electron/types";

// ─── Icons ──────────────────────────────────────────────────────────────────

export function LaunchIcon({ spinning }: { spinning: boolean }) {
  if (spinning) {
    return (
      <svg
        width="13"
        height="13"
        viewBox="0 0 14 14"
        fill="none"
        style={{ animation: "spin 1s linear infinite" }}
      >
        <circle
          cx="7"
          cy="7"
          r="5.5"
          stroke="rgba(255,255,255,0.3)"
          strokeWidth="1.5"
        />
        <path
          d="M7 1.5A5.5 5.5 0 0 1 12.5 7"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <path
        d="M3 7h8M8 4l3 3-3 3"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M6.5 1.5h3L10 3.4a5 5 0 011.2.7l1.8-.7 1.5 2.6-1.3 1.3a5 5 0 010 1.4l1.3 1.3-1.5 2.6-1.8-.7a5 5 0 01-1.2.7l-.5 1.9h-3L6 12.6a5 5 0 01-1.2-.7l-1.8.7L1.5 10l1.3-1.3a5 5 0 010-1.4L1.5 6l1.5-2.6 1.8.7A5 5 0 016 3.4l.5-1.9z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function shortPath(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  return parts.length <= 1 ? dir : `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

// ─── ProfileTopBar ──────────────────────────────────────────────────────────

interface ProfileTopBarProps {
  profile: Profile | null;
  isNew: boolean;
  name: string;
  dirty: boolean;
  selectedPlugins: string[];
  directories: string[];
  launchDir: string;
  launching: boolean;
  onSetLaunchDir: (dir: string) => void;
  onSetConfirmDelete: (v: boolean) => void;
  onDuplicate?: (name: string) => void;
  onSetOverviewOpen: (v: boolean) => void;
  onSetSettingsOpen: (v: boolean) => void;
  onSave: () => void;
  onLaunch: () => void;
}

export function ProfileTopBar({
  profile,
  isNew,
  name,
  dirty,
  selectedPlugins,
  directories,
  launchDir,
  launching,
  onSetLaunchDir,
  onSetConfirmDelete,
  onDuplicate,
  onSetOverviewOpen,
  onSetSettingsOpen,
  onSave,
  onLaunch,
}: ProfileTopBarProps) {
  const enabledCount = selectedPlugins.length;
  const subtitle = isNew
    ? "Configure plugins and skills for this profile"
    : enabledCount === 0
    ? "No plugins enabled"
    : `${enabledCount} plugin${enabledCount !== 1 ? "s" : ""} enabled`;

  return (
    <div className="pe-topbar">
      <div className="pe-topbar-identity">
        <h2 className="pe-topbar-name">{isNew ? "New Profile" : name}</h2>
        <span className="pe-topbar-subtitle">{subtitle}</span>
      </div>

      <div className="pe-topbar-actions">
        {/* Delete — only for existing profiles */}
        {!isNew && profile && (
          <button
            className="pe-delete-btn"
            onClick={() => onSetConfirmDelete(true)}
            title="Delete profile"
          >
            <svg width="13" height="13" viewBox="0 0 12 13" fill="none">
              <path d="M1 3h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <path d="M4.5 3V2a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <path d="M2 3l.7 7.3A.8.8 0 0 0 2.7 11h6.6a.8.8 0 0 0 .8-.7L10.8 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M4.5 5.5v3M7.5 5.5v3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
            </svg>
          </button>
        )}

        {/* Duplicate — only for existing profiles */}
        {!isNew && profile && onDuplicate && (
          <button
            className="pe-duplicate-btn"
            onClick={() => onDuplicate(profile.name)}
            title="Duplicate profile"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <rect x="4" y="4" width="8" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
              <path d="M2 10V2.8A.8.8 0 0 1 2.8 2H10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        )}

        {/* Overview */}
        {!isNew && profile && (
          <button
            className="pe-settings-btn"
            onClick={() => onSetOverviewOpen(true)}
            title="Profile overview"
            aria-label="Open profile overview"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
              <path d="M4.5 6h7M4.5 8.5h5M4.5 11h3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
            </svg>
            <span>Overview</span>
          </button>
        )}

        {/* Settings gear */}
        <button
          className="pe-settings-btn"
          onClick={() => onSetSettingsOpen(true)}
          title="Session settings"
          aria-label="Open session settings"
        >
          <GearIcon />
          <span>Settings</span>
        </button>

        {/* Save */}
        <button
          className="btn-primary"
          disabled={!name.trim() || !dirty}
          onClick={onSave}
        >
          {isNew ? "Create Profile" : "Save"}
        </button>

        {/* Launch — only for existing profiles */}
        {!isNew && profile && (
          <div className="pe-launch-group">
            {directories.length >= 1 && (
              <select
                className="pe-launch-dir-select"
                value={launchDir}
                onChange={(e) => onSetLaunchDir(e.target.value)}
              >
                <option value="">None (choose at launch)</option>
                {directories.map((dir) => (
                  <option key={dir} value={dir}>{shortPath(dir)}</option>
                ))}
              </select>
            )}
            <button
              className={`btn-launch${launching ? " launching" : ""}`}
              disabled={launching}
              onClick={onLaunch}
              aria-label="Launch profile in iTerm2"
            >
              <span className="btn-launch-icon">
                <LaunchIcon spinning={launching} />
              </span>
              {launching ? "Launching..." : "Launch"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
