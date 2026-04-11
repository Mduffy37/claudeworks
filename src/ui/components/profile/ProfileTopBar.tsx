import React, { useState } from "react";
import type { Profile, LaunchOptions } from "../../../electron/types";
import { LaunchOptionsPopover } from "../shared/LaunchOptionsPopover";

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
        <circle cx="7" cy="7" r="5.5" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
        <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <path d="M3 7h8M8 4l3 3-3 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
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
  saving: boolean;
  saveStatus: "idle" | "saved";
  selectedPlugins: string[];
  directories: string[];
  launchDir: string;
  launching: boolean;
  onChangeName: (v: string) => void;
  markDirty: () => void;
  onSetLaunchDir: (dir: string) => void;
  onSetConfirmDelete: (v: boolean) => void;
  onDuplicate?: (name: string) => void;
  onSetOverviewOpen: (v: boolean) => void;
  onSave: () => void;
  onLaunch: () => void;
  onLaunchWithOptions?: (options: LaunchOptions) => void;
}

export function ProfileTopBar({
  profile,
  isNew,
  name,
  dirty,
  saving,
  saveStatus,
  selectedPlugins,
  directories,
  launchDir,
  launching,
  onChangeName,
  markDirty,
  onSetLaunchDir,
  onSetConfirmDelete,
  onDuplicate,
  onSetOverviewOpen,
  onSave,
  onLaunch,
  onLaunchWithOptions,
}: ProfileTopBarProps) {
  const [showOverflow, setShowOverflow] = useState(false);
  const [showLaunchOptions, setShowLaunchOptions] = useState(false);
  const enabledCount = selectedPlugins.length;
  const subtitle = isNew
    ? "Configure plugins and skills for this profile"
    : enabledCount === 0
    ? "No plugins enabled"
    : `${enabledCount} plugin${enabledCount !== 1 ? "s" : ""} enabled`;

  return (
    <div className="pe-topbar">
      {/* Left: Name + subtitle, vertically centered */}
      <div className="pe-topbar-identity">
        <input
          className="pe-topbar-name-input"
          value={name}
          onChange={(e) => { onChangeName(e.target.value); markDirty(); }}
          placeholder={isNew ? "Profile name..." : ""}
          autoFocus={isNew}
        />
        <span className="pe-topbar-subtitle">{subtitle}</span>
      </div>

      {/* Right: stacked controls */}
      <div className="pe-topbar-right">
        {/* Row 1: dir select + Launch */}
        {!isNew && profile && (
          <div className="pe-topbar-controls-row">
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
            <div className="btn-launch-group">
              <button
                className={`btn-launch${launching ? " launching" : ""}`}
                disabled={launching}
                onClick={onLaunch}
                aria-label="Launch profile in iTerm2"
              >
                <span className="btn-launch-icon">
                  <LaunchIcon spinning={launching} />
                </span>
                {launching ? "Launching\u2026" : "Launch"}
              </button>
              <button
                className="btn-launch-settings"
                onClick={() => setShowLaunchOptions(true)}
                aria-label="Launch settings"
                title="Launch settings"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 3.5l3 3 3-3" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {showLaunchOptions && onLaunchWithOptions && (
                <LaunchOptionsPopover
                  defaultDangerous={profile?.launchFlags?.dangerouslySkipPermissions}
                  onLaunch={(opts) => { setShowLaunchOptions(false); onLaunchWithOptions(opts); }}
                  onClose={() => setShowLaunchOptions(false)}
                />
              )}
            </div>
          </div>
        )}

        {/* Row 2: ... + Settings + Save */}
        <div className="pe-topbar-controls-row pe-topbar-controls-row-end">
          {!isNew && profile && (
            <div className="pe-topbar-secondary">
              <button
                className="pe-overflow-btn"
                onClick={() => setShowOverflow(!showOverflow)}
                title="More actions"
                aria-label="More actions"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <circle cx="3" cy="8" r="1.3" fill="currentColor" />
                  <circle cx="8" cy="8" r="1.3" fill="currentColor" />
                  <circle cx="13" cy="8" r="1.3" fill="currentColor" />
                </svg>
              </button>
              {showOverflow && (
                <>
                  <div className="pe-overflow-backdrop" onClick={() => setShowOverflow(false)} />
                  <div className="pe-overflow-menu">
                    {onDuplicate && (
                      <button onClick={() => { setShowOverflow(false); onDuplicate(profile.name); }}>
                        Duplicate
                      </button>
                    )}
                    <button onClick={() => { setShowOverflow(false); onSetOverviewOpen(true); }}>
                      Overview
                    </button>
                    <div className="pe-overflow-divider" />
                    <button className="pe-overflow-danger" onClick={() => { setShowOverflow(false); onSetConfirmDelete(true); }}>
                      Delete Profile
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <button
            className="btn-primary"
            disabled={!name.trim() || !dirty || saving}
            onClick={onSave}
          >
            {saving ? "Saving\u2026" : saveStatus === "saved" ? "\u2713 Saved" : isNew ? "Create Profile" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
