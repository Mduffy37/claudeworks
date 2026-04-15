import React, { useState, useMemo, useEffect } from "react";
import type { Profile } from "../../../src/electron/types";

interface Props {
  profiles: Profile[];
  selectedName: string | null;
  profileHealth: Record<string, string[]>;
  importedProjects?: string[];
  onSelect: (name: string) => void;
  onNew: () => void;
  onLaunch: (name: string, directory?: string) => void;
  onSave?: () => Promise<void> | void;
  dirty?: boolean;
  onToggleFavourite?: (name: string) => void;
  onOpenProjectsConfig?: () => void;
  onRequestFocusTagsOnSelected?: () => void;
  onRequestFocusProjectsOnSelected?: () => void;
}

// Deterministic single-letter avatar from profile name
function profileInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "P";
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function shortPath(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  return parts.length <= 1 ? dir : `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

function SidebarLaunch({ profile, onLaunch, onSave, isSelectedAndDirty, importedProjects = [], onOpenProjectsConfig }: {
  profile: Profile;
  onLaunch: (name: string, directory?: string) => void;
  onSave?: () => Promise<void> | void;
  isSelectedAndDirty?: boolean;
  importedProjects?: string[];
  onOpenProjectsConfig?: () => void;
}) {
  const profileDirs = profile.directories ?? (profile.directory ? [profile.directory] : []);
  const dirs = [...new Set([...importedProjects, ...profileDirs])];
  const storageKey = `launchDir:${profile.name}`;
  const [selectedDir, setSelectedDir] = useState(() => {
    if (typeof window === "undefined") return profileDirs[0] ?? "";
    const stored = window.localStorage.getItem(storageKey);
    if (stored && dirs.includes(stored)) return stored;
    return profileDirs[0] ?? "";
  });

  // Re-sync if persisted value changes elsewhere (e.g. ProfileEditor topbar) or
  // if the dropdown's list stops including the stored value.
  useEffect(() => {
    const stored = window.localStorage.getItem(storageKey);
    if (stored && dirs.includes(stored)) {
      if (stored !== selectedDir) setSelectedDir(stored);
    } else if (selectedDir && !dirs.includes(selectedDir)) {
      setSelectedDir(profileDirs[0] ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.name, dirs.join("|")]);

  const updateSelectedDir = (dir: string) => {
    setSelectedDir(dir);
    if (dir) window.localStorage.setItem(storageKey, dir);
    else window.localStorage.removeItem(storageKey);
  };

  const handleLaunch = async () => {
    if (isSelectedAndDirty && onSave) {
      await onSave();
    }
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
        aria-label={`Launch directory for ${profile.name}`}
        value={selectedDir}
        onChange={(e) => updateSelectedDir(e.target.value)}
        onMouseDown={(e) => {
          if (importedProjects.length === 0) {
            e.preventDefault();
            onOpenProjectsConfig?.();
          }
        }}
      >
        <option value="">None</option>
        {dirs.map((dir) => (
          <option key={dir} value={dir}>{shortPath(dir)}</option>
        ))}
      </select>
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
    </div>
  );
}

type SidebarSort = "name" | "plugins" | "recent" | "favourites";

export function ProfileList({ profiles, selectedName, profileHealth, importedProjects, onSelect, onNew, onLaunch, onSave, dirty, onToggleFavourite, onOpenProjectsConfig, onRequestFocusTagsOnSelected, onRequestFocusProjectsOnSelected }: Props) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SidebarSort>("name");
  const [tagFilter, setTagFilter] = useState("");
  const [projectFilter, setProjectFilter] = useState("");

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const p of profiles) {
      for (const t of p.tags ?? []) tags.add(t);
    }
    return Array.from(tags).sort();
  }, [profiles]);

  const allProjects = useMemo(() => {
    const set = new Set<string>();
    for (const p of profiles) {
      for (const dir of p.projects ?? []) set.add(dir);
    }
    return Array.from(set).sort();
  }, [profiles]);

  const filtered = useMemo(() => {
    let result = profiles;
    const q = search.toLowerCase().trim();
    if (q) result = result.filter((p) => p.name.toLowerCase().includes(q));
    if (tagFilter) result = result.filter((p) => (p.tags ?? []).includes(tagFilter));
    if (projectFilter) result = result.filter((p) => (p.projects ?? []).includes(projectFilter));
    if (sortBy === "favourites") {
      result = result.filter((p) => p.favourite);
    }
    if (sortBy === "name" || sortBy === "favourites") result = [...result].sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === "plugins") result = [...result].sort((a, b) => b.plugins.length - a.plugins.length);
    else if (sortBy === "recent") result = [...result].sort((a, b) => (b.lastLaunched ?? 0) - (a.lastLaunched ?? 0));
    // Favourites always float to the top (when not already filtering to favourites only)
    if (sortBy !== "favourites") {
      result = [...result].sort((a, b) => (b.favourite ? 1 : 0) - (a.favourite ? 1 : 0));
    }
    return result;
  }, [profiles, search, sortBy, tagFilter, projectFilter]);

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
        <div className="pl-search-area">
          <div className="pl-search">
            <input
              type="text"
              className="pl-search-input"
              placeholder="Search profiles..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="pl-filters">
            {allTags.length > 0 ? (
              <select
                className="pl-sort-select"
                value={tagFilter}
                onChange={(e) => setTagFilter(e.target.value)}
                title="Filter by tag"
              >
                <option value="">All tags</option>
                {allTags.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            ) : (
              <button
                type="button"
                className="sidebar-filter-empty"
                onClick={() => onRequestFocusTagsOnSelected?.()}
                title={selectedName ? "Add a tag to the selected profile" : "Select a profile first, then click to add a tag"}
              >
                + Tag
              </button>
            )}
            {allProjects.length > 0 ? (
              <select
                className="pl-sort-select"
                value={projectFilter}
                onChange={(e) => setProjectFilter(e.target.value)}
                title="Filter by project"
              >
                <option value="">All projects</option>
                {allProjects.map((p) => (
                  <option key={p} value={p}>{shortPath(p)}</option>
                ))}
              </select>
            ) : (
              <button
                type="button"
                className="sidebar-filter-empty"
                onClick={() => onRequestFocusProjectsOnSelected?.()}
                title={selectedName ? "Add a project to the selected profile" : "Select a profile first, then click to add a project"}
              >
                + Project
              </button>
            )}
            <select
              className="pl-sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SidebarSort)}
              title="Sort by"
            >
              <option value="name">A-Z</option>
              <option value="plugins">Plugins</option>
              <option value="recent">Recent</option>
              <option value="favourites">Favourites</option>
            </select>
          </div>
        </div>
      )}

      <div className="profile-list-items" role="list" aria-label="Profiles">
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
              role="listitem"
              className={`profile-item ${p.name === selectedName ? "selected" : ""}`}
            >
              <button
                type="button"
                className="profile-item-select"
                onClick={() => onSelect(p.name)}
                aria-current={p.name === selectedName ? "true" : undefined}
                aria-label={`Select profile ${p.name}${p.isDefault ? " (default)" : ""}, ${p.plugins.length} plugin${p.plugins.length !== 1 ? "s" : ""}`}
              >
                <div className="profile-item-icon" aria-hidden="true">
                  {profileInitial(p.name)}
                </div>
                <div className="profile-item-body">
                  <div className="profile-item-name">
                    {p.name}
                    {p.isDefault && (
                      <span className="default-badge" aria-hidden="true">DEFAULT</span>
                    )}
                    {profileHealth[p.name] && (
                      <span
                        className="health-badge"
                        aria-label={`${profileHealth[p.name].length} missing plugin${profileHealth[p.name].length !== 1 ? "s" : ""}`}
                      >
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                          <path d="M8 1.5L14.5 13H1.5L8 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none" />
                          <path d="M8 6v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                          <circle cx="8" cy="11" r="0.7" fill="currentColor" />
                        </svg>
                      </span>
                    )}
                  </div>
                  <div className="profile-item-meta" aria-hidden="true">
                    {p.plugins.length} plugin{p.plugins.length !== 1 ? "s" : ""}
                    {p.lastLaunched ? ` · ${timeAgo(p.lastLaunched)}` : ""}
                  </div>
                </div>
              </button>
              {onToggleFavourite && (
                <button
                  type="button"
                  className={`sidebar-fav-btn${p.favourite ? " active" : ""}`}
                  onClick={(e) => { e.stopPropagation(); onToggleFavourite(p.name); }}
                  aria-pressed={p.favourite}
                  aria-label={p.favourite ? `Remove ${p.name} from favourites` : `Add ${p.name} to favourites`}
                >
                  <span aria-hidden="true">{p.favourite ? "\u2605" : "\u2606"}</span>
                </button>
              )}
              <SidebarLaunch profile={p} onLaunch={onLaunch} onSave={onSave} isSelectedAndDirty={p.name === selectedName && !!dirty} importedProjects={importedProjects} onOpenProjectsConfig={onOpenProjectsConfig} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
