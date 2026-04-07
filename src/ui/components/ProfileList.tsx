import React from "react";
import type { Profile } from "../../../src/electron/types";

interface Props {
  profiles: Profile[];
  selectedName: string | null;
  onSelect: (name: string) => void;
  onNew: () => void;
  onDelete: (name: string) => void;
}

export function ProfileList({ profiles, selectedName, onSelect, onNew, onDelete }: Props) {
  return (
    <div className="profile-list">
      <div className="profile-list-header">
        <h2>Profiles</h2>
        <button className="btn-icon" onClick={onNew} title="New profile">
          +
        </button>
      </div>
      <div className="profile-list-items">
        {profiles.length === 0 && (
          <div className="empty-state">No profiles yet. Create one to get started.</div>
        )}
        {profiles.map((p) => (
          <div
            key={p.name}
            className={`profile-item ${p.name === selectedName ? "selected" : ""}`}
            onClick={() => onSelect(p.name)}
          >
            <div className="profile-item-name">{p.name}</div>
            <div className="profile-item-meta">
              {p.plugins.length} plugin{p.plugins.length !== 1 ? "s" : ""}
            </div>
            <button
              className="btn-delete"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(p.name);
              }}
              title="Delete profile"
            >
              x
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
