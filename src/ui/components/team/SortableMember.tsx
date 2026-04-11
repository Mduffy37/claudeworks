import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { TeamMember, Profile, TeammateColour } from "../../../electron/types";

const TEAMMATE_COLOURS: { name: TeammateColour; hex: string }[] = [
  { name: "red", hex: "#ef4444" },
  { name: "blue", hex: "#3b82f6" },
  { name: "green", hex: "#22c55e" },
  { name: "yellow", hex: "#eab308" },
  { name: "purple", hex: "#a855f7" },
  { name: "orange", hex: "#f97316" },
  { name: "pink", hex: "#ec4899" },
  { name: "cyan", hex: "#06b6d4" },
];

export function colourHex(colour?: TeammateColour): string | undefined {
  if (!colour) return undefined;
  return TEAMMATE_COLOURS.find((c) => c.name === colour)?.hex;
}

export function SortableMember({
  member,
  profile,
  isBroken,
  onRemove,
  onSetLead,
  onRoleChange,
  onInstructionsChange,
  onColourChange,
  onNavigateToProfile,
}: {
  member: TeamMember;
  profile: Profile | undefined;
  isBroken: boolean;
  onRemove: () => void;
  onSetLead: () => void;
  onRoleChange: (role: string) => void;
  onInstructionsChange: (instructions: string) => void;
  onColourChange: (colour: TeammateColour | undefined) => void;
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
        {/* Colour picker hidden — Claude Code's spawn tool doesn't accept a color
            input parameter yet (Xt() auto-assigns). The TeamMember.colour field and
            TEAMMATE_COLOURS palette are ready; re-enable this UI block once Anthropic
            adds color support to the Agent tool's spawn input schema. */}
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
