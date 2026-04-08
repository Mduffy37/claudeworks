import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TeamMember, Profile } from "../../../electron/types";

export function SortableMember({
  member,
  profile,
  isBroken,
  onRemove,
  onSetLead,
  onRoleChange,
  onInstructionsChange,
  onNavigateToProfile,
}: {
  member: TeamMember;
  profile: Profile | undefined;
  isBroken: boolean;
  onRemove: () => void;
  onSetLead: () => void;
  onRoleChange: (role: string) => void;
  onInstructionsChange: (instructions: string) => void;
  onNavigateToProfile?: (name: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: `member-${member.profile}`,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const initial = member.profile.trim().charAt(0).toUpperCase() || "?";
  const pluginCount = profile?.plugins.length ?? 0;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`te-member-card${member.isLead ? " lead" : ""}${isBroken ? " broken" : ""}`}
    >
      <div className="te-member-header">
        <div className="te-member-left">
          <span className="te-drag-handle" {...attributes} {...listeners}>&#x2807;</span>
          <div className="te-member-avatar">{initial}</div>
          <div>
            <div className="te-member-name">
              {onNavigateToProfile ? (
                <span className="te-member-name-link" onClick={(e) => { e.stopPropagation(); onNavigateToProfile(member.profile); }} title={`Go to ${member.profile}`}>
                  {member.profile}
                </span>
              ) : member.profile}
              {member.isLead && <span className="te-lead-badge">LEAD</span>}
              {isBroken && <span className="te-broken-badge">Missing</span>}
            </div>
            <div className="te-member-meta">{pluginCount} plugin{pluginCount !== 1 ? "s" : ""}</div>
          </div>
        </div>
        <div className="te-member-right">
          {!member.isLead && (
            <button className="te-set-lead" onClick={onSetLead}>Set as lead</button>
          )}
          <button className="te-remove" onClick={onRemove}>&times;</button>
        </div>
      </div>
      <div className="te-member-fields">
        <div className="te-field-row">
          <span className="te-field-label">Role</span>
          <input
            className="te-field-input"
            value={member.role}
            onChange={(e) => onRoleChange(e.target.value)}
            placeholder="e.g. Lead Researcher"
          />
        </div>
        <div className="te-field-row">
          <span className="te-field-label">Instructions</span>
          <textarea
            className="te-field-textarea"
            value={member.instructions}
            onChange={(e) => onInstructionsChange(e.target.value)}
            placeholder="Instructions for this agent in the team context..."
          />
        </div>
      </div>
    </div>
  );
}
