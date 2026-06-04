import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation(["team", "common"]);
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
                <span className="te-member-name-link" onClick={(e) => { e.stopPropagation(); onNavigateToProfile(member.profile); }} title={t("team:member.goToProfile", { name: member.profile })}>
                  {member.profile}
                </span>
              ) : member.profile}
              {member.isLead && <span className="te-lead-badge">{t("team:member.lead")}</span>}
              {isBroken && <span className="te-broken-badge">{t("team:member.missing")}</span>}
            </div>
            <div className="te-member-meta">{t("team:member.pluginCount", { count: pluginCount })}</div>
          </div>
        </div>
        <div className="te-member-right">
          {!member.isLead && (
            <button className="te-set-lead" onClick={onSetLead}>{t("team:member.setAsLead")}</button>
          )}
          <button
            className="te-remove"
            onClick={onRemove}
            aria-label={t("team:member.removeFromTeam", { name: member.profile })}
          >
            <span aria-hidden="true">&times;</span>
          </button>
        </div>
      </div>
      <div className="te-member-fields">
        {/* Colour picker hidden — Claude Code's spawn tool doesn't accept a color
            input parameter yet (Xt() auto-assigns). The TeamMember.colour field and
            TEAMMATE_COLOURS palette are ready; re-enable this UI block once Anthropic
            adds color support to the Agent tool's spawn input schema. */}
        <div className="te-field-row">
          <span className="te-field-label">{t("team:editor.role")}</span>
          <input
            className="te-field-input"
            value={member.role}
            onChange={(e) => onRoleChange(e.target.value)}
            placeholder={t("team:member.rolePlaceholder")}
          />
        </div>
        <div className="te-field-row">
          <span className="te-field-label">{t("team:editor.instructions")}</span>
          <textarea
            className="te-field-textarea"
            value={member.instructions}
            onChange={(e) => onInstructionsChange(e.target.value)}
            placeholder={t("team:member.instructionsPlaceholder")}
          />
        </div>
      </div>
    </div>
  );
}
