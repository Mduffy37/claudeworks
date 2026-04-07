import React, { useState } from "react";
import type { Profile } from "../../../src/electron/types";

interface Props {
  profiles: Profile[];
  selectedName: string | null;
  onSelect: (name: string) => void;
  onNew: () => void;
  onDelete: (name: string) => void;
  onLaunch: (name: string, directory?: string) => void;
}

// Deterministic single-letter avatar from profile name
function profileInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "P";
}

function SidebarLaunch({ profile, onLaunch }: { profile: Profile; onLaunch: (name: string, directory?: string) => void }) {
  const dirs = profile.directories ?? (profile.directory ? [profile.directory] : []);
  const [selectedDir, setSelectedDir] = useState(dirs[0] ?? "");

  if (dirs.length <= 1) {
    return (
      <button
        className="btn-launch-sidebar"
        onClick={(e) => {
          e.stopPropagation();
          onLaunch(profile.name, dirs[0]);
        }}
        title={`Launch "${profile.name}"`}
      >
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
          <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Launch
      </button>
    );
  }

  return (
    <div className="sidebar-launch-group" onClick={(e) => e.stopPropagation()}>
      <select
        className="sidebar-launch-select"
        value={selectedDir}
        onChange={(e) => setSelectedDir(e.target.value)}
      >
        {dirs.map((dir) => (
          <option key={dir} value={dir}>{dir.split("/").pop()}</option>
        ))}
      </select>
      <button
        className="btn-launch-sidebar"
        onClick={() => onLaunch(profile.name, selectedDir)}
        title={`Launch "${profile.name}" in ${selectedDir}`}
      >
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
          <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Launch
      </button>
    </div>
  );
}

export function ProfileList({ profiles, selectedName, onSelect, onNew, onDelete, onLaunch }: Props) {
  return (
    <div className="profile-list">
      <div className="profile-list-header">
        <h2>Profiles</h2>
        <button className="btn-icon" onClick={onNew} title="New profile" aria-label="New profile">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="profile-list-items">
        {profiles.length === 0 ? (
          <div className="empty-state" style={{ padding: "20px 8px" }}>
            <div className="empty-state-icon">&#9711;</div>
            <div className="empty-state-title">No profiles yet</div>
            <div className="empty-state-body">
              Create a profile to save a named set of plugins and skills.
            </div>
          </div>
        ) : (
          profiles.map((p) => (
            <div
              key={p.name}
              className={`profile-item ${p.name === selectedName ? "selected" : ""}`}
              onClick={() => onSelect(p.name)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => e.key === "Enter" && onSelect(p.name)}
            >
              <div className="profile-item-icon">
                {profileInitial(p.name)}
              </div>
              <div className="profile-item-body">
                <div className="profile-item-name">{p.name}</div>
                <div className="profile-item-meta">
                  {p.plugins.length} plugin{p.plugins.length !== 1 ? "s" : ""}
                </div>
              </div>
              <button
                className="btn-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(p.name);
                }}
                title={`Delete "${p.name}"`}
                aria-label={`Delete profile ${p.name}`}
              >
                <svg width="11" height="11" viewBox="0 0 12 13" fill="none">
                  {/* lid */}
                  <path d="M1 3h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  {/* handle */}
                  <path d="M4.5 3V2a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                  {/* body */}
                  <path d="M2 3l.7 7.3A.8.8 0 0 0 2.7 11h6.6a.8.8 0 0 0 .8-.7L10.8 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                  {/* inner lines */}
                  <path d="M4.5 5.5v3M7.5 5.5v3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                </svg>
              </button>
              <SidebarLaunch profile={p} onLaunch={onLaunch} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
