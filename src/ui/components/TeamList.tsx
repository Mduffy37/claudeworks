import React from "react";
import type { Team } from "../../electron/types";

interface Props {
  teams: Team[];
  selectedTeam: string | null;
  teamHealth: Record<string, string[]>;
  onSelect: (name: string) => void;
  onNew: () => void;
}

export function TeamList({ teams, selectedTeam, teamHealth, onSelect, onNew }: Props) {
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

      <div className="profile-list-items">
        {teams.length === 0 ? (
          <div className="empty-state" style={{ padding: "20px 8px" }}>
            <div className="empty-state-icon">&#9711;</div>
            <div className="empty-state-title">No teams yet</div>
            <div className="empty-state-body">
              Create a team to group profiles into coordinated agent sessions.
            </div>
          </div>
        ) : (
          teams.map((t) => {
            const lead = t.members.find((m) => m.isLead);
            const health = teamHealth[t.name];
            return (
              <div
                key={t.name}
                className={`profile-item${t.name === selectedTeam ? " selected" : ""}`}
                onClick={() => onSelect(t.name)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && onSelect(t.name)}
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
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
