import React, { useState, useMemo } from "react";
import type { Profile } from "../../../src/electron/types";

interface Props {
  profiles: Profile[];
  selectedName: string | null;
  profileHealth: Record<string, string[]>;
  onSelect: (name: string) => void;
  onNew: () => void;
  onLaunch: (name: string, directory?: string) => void;
  dirty?: boolean;
}

// Deterministic single-letter avatar from profile name
function profileInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "P";
}

function shortPath(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  return parts.length <= 1 ? dir : `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

function SidebarLaunch({ profile, onLaunch, isSelectedAndDirty }: {
  profile: Profile;
  onLaunch: (name: string, directory?: string) => void;
  isSelectedAndDirty?: boolean;
}) {
  const dirs = profile.directories ?? (profile.directory ? [profile.directory] : []);
  const [selectedDir, setSelectedDir] = useState(dirs[0] ?? "");

  const handleLaunch = async () => {
    let dir = selectedDir || undefined;
    if (!dir) {
      const picked = await window.api.selectDirectory();
      if (!picked) return;
      dir = picked;
    }
    onLaunch(profile.name, dir);
  };

  return (
    <div className="sidebar-launch-group" onClick={(e) => e.stopPropagation()}>
      <select
        className="sidebar-launch-select"
        value={selectedDir}
        onChange={(e) => setSelectedDir(e.target.value)}
      >
        <option value="">None</option>
        {dirs.map((dir) => (
          <option key={dir} value={dir}>{shortPath(dir)}</option>
        ))}
      </select>
      {isSelectedAndDirty ? (
        <button className="btn-launch-sidebar" disabled title="Save changes first">
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
            <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="btn-launch-label">Save first</span>
        </button>
      ) : (
        <button
          className="btn-launch-sidebar"
          onClick={handleLaunch}
          title={`Launch "${profile.name}"${selectedDir ? ` in ${shortPath(selectedDir)}` : ""}`}
        >
          <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
            <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="btn-launch-label">Launch</span>
        </button>
      )}
    </div>
  );
}

export function ProfileList({ profiles, selectedName, profileHealth, onSelect, onNew, onLaunch, dirty }: Props) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return profiles;
    return profiles.filter((p) => p.name.toLowerCase().includes(q));
  }, [profiles, search]);

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

      {profiles.length > 0 && (
        <div className="pl-search">
          <input
            type="text"
            className="pl-search-input"
            placeholder="Search profiles..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      )}

      <div className="profile-list-items">
        {filtered.length === 0 && !search ? (
          <div className="empty-state" style={{ padding: "20px 8px" }}>
            <div className="empty-state-icon">&#9711;</div>
            <div className="empty-state-title">No profiles yet</div>
            <div className="empty-state-body">
              Profiles save named presets of plugins, skills, and settings for Claude Code sessions.
              Click <strong>+</strong> above to create your first profile.
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: "20px 8px" }}>
            <div className="empty-state-title">No matches</div>
          </div>
        ) : (
          filtered.map((p) => (
            <div
              key={p.name}
              className={`profile-item ${p.name === selectedName ? "selected" : ""}`}
              onClick={() => onSelect(p.name)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(p.name);
                }
              }}
            >
              <div className="profile-item-icon">
                {profileInitial(p.name)}
              </div>
              <div className="profile-item-body">
                <div className="profile-item-name">
                  {p.name}
                  {profileHealth[p.name] && (
                    <span
                      className="health-badge"
                      title={`${profileHealth[p.name].length} missing plugin${profileHealth[p.name].length !== 1 ? "s" : ""}`}
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none">
                        <path d="M8 1.5L14.5 13H1.5L8 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none" />
                        <path d="M8 6v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        <circle cx="8" cy="11" r="0.7" fill="currentColor" />
                      </svg>
                    </span>
                  )}
                </div>
                <div className="profile-item-meta">
                  {p.plugins.length} plugin{p.plugins.length !== 1 ? "s" : ""}
                </div>
              </div>
              <SidebarLaunch profile={p} onLaunch={onLaunch} isSelectedAndDirty={p.name === selectedName && !!dirty} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
