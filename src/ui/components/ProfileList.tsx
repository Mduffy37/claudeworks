import React from "react";
import type { Profile } from "../../../src/electron/types";

interface Props {
  profiles: Profile[];
  selectedName: string | null;
  onSelect: (name: string) => void;
  onNew: () => void;
  onDelete: (name: string) => void;
}

// Deterministic single-letter avatar from profile name
function profileInitial(name: string): string {
  return name.trim().charAt(0).toUpperCase() || "P";
}

export function ProfileList({ profiles, selectedName, onSelect, onNew, onDelete }: Props) {
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
                <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                  <path d="M1 1l6 6M7 1L1 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
