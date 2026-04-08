import React, { useState, useMemo } from "react";
import type { Team } from "../../electron/types";

interface Props {
  teams: Team[];
  selectedTeam: string | null;
  teamHealth: Record<string, string[]>;
  importedProjects?: string[];
  onSelect: (name: string) => void;
  onNew: () => void;
  onLaunch: (name: string, directory?: string) => void;
}

function shortPath(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  return parts.length <= 1 ? dir : `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

function TeamSidebarLaunch({ team, onLaunch, importedProjects = [] }: { team: Team; onLaunch: (name: string, directory?: string) => void; importedProjects?: string[] }) {
  const [selectedDir, setSelectedDir] = useState("");
  const lead = team.members.find((m) => m.isLead);

  const handleLaunch = async () => {
    if (!lead) return;
    let dir = selectedDir || undefined;
    if (!dir) {
      const picked = await window.api.selectDirectory();
      if (!picked) return;
      dir = picked;
    }
    onLaunch(lead.profile, dir);
  };

  return (
    <div className="sidebar-launch-group" onClick={(e) => e.stopPropagation()}>
      <select
        className="sidebar-launch-select"
        value={selectedDir}
        onChange={(e) => setSelectedDir(e.target.value)}
      >
        <option value="">None</option>
        {importedProjects.map((dir) => (
          <option key={dir} value={dir}>{shortPath(dir)}</option>
        ))}
      </select>
      <button
        className="btn-launch-sidebar"
        onClick={handleLaunch}
        disabled={!lead}
        title={lead ? `Launch lead profile "${lead.profile}"` : "No lead profile set"}
      >
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none">
          <path d="M3 7h8M8 4l3 3-3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="btn-launch-label">Launch</span>
      </button>
    </div>
  );
}

type SidebarSort = "name" | "members";

export function TeamList({ teams, selectedTeam, teamHealth, importedProjects, onSelect, onNew, onLaunch }: Props) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SidebarSort>("name");
  const [tagFilter, setTagFilter] = useState("");

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const t of teams) {
      for (const tag of t.tags ?? []) tags.add(tag);
    }
    return Array.from(tags).sort();
  }, [teams]);

  const filtered = useMemo(() => {
    let result = teams;
    const q = search.toLowerCase().trim();
    if (q) result = result.filter((t) => t.name.toLowerCase().includes(q));
    if (tagFilter) result = result.filter((t) => (t.tags ?? []).includes(tagFilter));
    if (sortBy === "name") result = [...result].sort((a, b) => a.name.localeCompare(b.name));
    else if (sortBy === "members") result = [...result].sort((a, b) => b.members.length - a.members.length);
    return result;
  }, [teams, search, sortBy, tagFilter]);

  return (
    <div className="team-list">
      <div className="profile-list-header">
        <h2>Teams</h2>
        <button className="btn-icon" onClick={onNew} title="New team" aria-label="New team">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {teams.length > 0 && (
        <div className="pl-search-area">
          <div className="pl-search">
            <input
              type="text"
              className="pl-search-input"
              placeholder="Search teams..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="pl-filters">
            {allTags.length > 0 && (
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
            )}
            <select
              className="pl-sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as SidebarSort)}
              title="Sort by"
            >
              <option value="name">A-Z</option>
              <option value="members">Members</option>
            </select>
          </div>
        </div>
      )}

      <div className="profile-list-items">
        {filtered.length === 0 && !search ? (
          <div className="empty-state" style={{ padding: "20px 8px" }}>
            <div className="empty-state-icon">&#9711;</div>
            <div className="empty-state-title">No teams yet</div>
            <div className="empty-state-body">
              Teams group profiles into coordinated multi-agent sessions.
              Click <strong>+</strong> above to create a team.
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty-state" style={{ padding: "20px 8px" }}>
            <div className="empty-state-title">No matches</div>
          </div>
        ) : (
          filtered.map((t) => {
            const lead = t.members.find((m) => m.isLead);
            const health = teamHealth[t.name];
            return (
              <div
                key={t.name}
                className={`profile-item${t.name === selectedTeam ? " selected" : ""}`}
                onClick={() => onSelect(t.name)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(t.name);
                  }
                }}
              >
                <div className="profile-item-icon" style={{ background: "var(--color-team-dim)", color: "var(--color-team)" }}>
                  {t.name.trim().charAt(0).toUpperCase() || "T"}
                </div>
                <div className="profile-item-body">
                  <div className="profile-item-name">
                    {t.name}
                    {health && (
                      <span
                        className="health-badge"
                        title={`${health.length} missing profile${health.length !== 1 ? "s" : ""}`}
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
                    {t.members.length} member{t.members.length !== 1 ? "s" : ""}
                    {lead ? ` · Lead: ${lead.profile}` : ""}
                  </div>
                </div>
                <TeamSidebarLaunch team={t} onLaunch={onLaunch} importedProjects={importedProjects} />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
