import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Team, TeamMember, Profile, MergePreview as MergePreviewType } from "../../electron/types";
import { MergePreview } from "./MergePreview";
import { ConfirmDialog } from "./shared/ConfirmDialog";

interface Props {
  team: Team | null;
  profiles: Profile[];
  isNew: boolean;
  brokenMembers: string[];
  onSave: (team: Team) => void | Promise<void>;
  onDelete: (name: string) => void;
  dirty: boolean;
  onDirtyChange: (v: boolean) => void;
}

function DraggableProfile({ profile, inTeam }: { profile: Profile; inTeam: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({
    id: `avail-${profile.name}`,
    disabled: inTeam,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: inTeam ? 0.4 : 1,
    cursor: inTeam ? "default" : "grab",
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} className="te-avail-item">
      <div className="te-avail-name">{profile.name}</div>
      <div className="te-avail-meta">
        {inTeam ? "Already in team" : `${profile.plugins.length} plugin${profile.plugins.length !== 1 ? "s" : ""}`}
      </div>
    </div>
  );
}

function SortableMember({
  member,
  profile,
  isBroken,
  onRemove,
  onSetLead,
  onRoleChange,
  onInstructionsChange,
}: {
  member: TeamMember;
  profile: Profile | undefined;
  isBroken: boolean;
  onRemove: () => void;
  onSetLead: () => void;
  onRoleChange: (role: string) => void;
  onInstructionsChange: (instructions: string) => void;
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
              {member.profile}
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
          <span className="te-field-label">Inst.</span>
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

export function TeamEditor({ team, profiles, isNew, brokenMembers, onSave, onDelete, dirty, onDirtyChange }: Props) {
  const [draft, setDraft] = useState<Team>({
    name: "",
    description: "",
    members: [],
  });
  const [showMergePreview, setShowMergePreview] = useState(false);
  const [mergeData, setMergeData] = useState<MergePreviewType | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (team) {
      setDraft({ ...team, members: team.members.map((m) => ({ ...m })) });
    } else if (isNew) {
      setDraft({ name: "", description: "", members: [] });
    }
    onDirtyChange(false);
    setShowMergePreview(false);
    setMergeData(null);
  }, [team, isNew]);

  const markDirty = useCallback(() => onDirtyChange(true), [onDirtyChange]);

  const updateDraft = useCallback((updates: Partial<Team>) => {
    setDraft((prev) => ({ ...prev, ...updates }));
    markDirty();
  }, [markDirty]);

  const memberProfileNames = useMemo(
    () => new Set(draft.members.map((m) => m.profile)),
    [draft.members]
  );

  const filteredProfiles = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return profiles;
    return profiles.filter((p) => p.name.toLowerCase().includes(q));
  }, [profiles, search]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const [activeId, setActiveId] = useState<string | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;

    const activeStr = String(active.id);
    const overStr = String(over.id);

    // Dragging from available -> members (drop zone or over a member)
    if (activeStr.startsWith("avail-")) {
      const profileName = activeStr.replace("avail-", "");
      if (memberProfileNames.has(profileName)) return;
      const newMember: TeamMember = {
        profile: profileName,
        role: "",
        instructions: "",
        isLead: draft.members.length === 0,
      };
      updateDraft({ members: [...draft.members, newMember] });
      return;
    }

    // Reordering within members
    if (activeStr.startsWith("member-") && overStr.startsWith("member-")) {
      const oldIndex = draft.members.findIndex((m) => `member-${m.profile}` === activeStr);
      const newIndex = draft.members.findIndex((m) => `member-${m.profile}` === overStr);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        updateDraft({ members: arrayMove(draft.members, oldIndex, newIndex) });
      }
    }
  };

  const handleRemoveMember = (profileName: string) => {
    const filtered = draft.members.filter((m) => m.profile !== profileName);
    // If we removed the lead, promote the first remaining member
    if (filtered.length > 0 && !filtered.some((m) => m.isLead)) {
      filtered[0].isLead = true;
    }
    updateDraft({ members: filtered });
  };

  const handleSetLead = (profileName: string) => {
    updateDraft({
      members: draft.members.map((m) => ({
        ...m,
        isLead: m.profile === profileName,
      })),
    });
  };

  const handleMemberField = (profileName: string, field: "role" | "instructions", value: string) => {
    updateDraft({
      members: draft.members.map((m) =>
        m.profile === profileName ? { ...m, [field]: value } : m
      ),
    });
  };

  const handleSave = async () => {
    if (!draft.name.trim()) return;
    await onSave(draft);
    onDirtyChange(false);
  };

  const handlePreviewMerge = async () => {
    const preview = await window.api.getTeamMergePreview(draft);
    setMergeData(preview);
    setShowMergePreview(true);
  };

  if (!team && !isNew) {
    return (
      <div className="pm-empty">
        <div className="empty-state">
          <div className="empty-state-title">Select a team to edit or create a new one</div>
        </div>
      </div>
    );
  }

  return (
    <div className="te-editor">
      {/* Top bar */}
      <div className="te-topbar">
        <div className="te-topbar-left">
          <h2 className="pe-topbar-name">{isNew ? "New Team" : draft.name}</h2>
          <span className="pe-topbar-subtitle">
            {draft.members.length} member{draft.members.length !== 1 ? "s" : ""}
          </span>
        </div>
        <div className="te-topbar-actions">
          {!isNew && (
            <button className="btn-icon te-delete-btn" onClick={() => setShowDeleteConfirm(true)} title="Delete team">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
          <button className="btn-update" onClick={handlePreviewMerge} disabled={draft.members.length === 0}>
            Preview Merge
          </button>
          <button className="btn-uninstall" disabled title="Coming soon" style={{ cursor: "not-allowed" }}>
            Launch &#x1f512;
          </button>
          <button
            className="btn-primary"
            disabled={!draft.name.trim() || !dirty}
            onClick={handleSave}
          >
            {isNew ? "Create Team" : "Save"}
          </button>
        </div>
      </div>

      {/* Name & description */}
      <div className="te-fields-bar">
        <div className="te-field-row">
          <span className="te-field-label">Name</span>
          <input
            className="te-field-input"
            value={draft.name}
            onChange={(e) => updateDraft({ name: e.target.value })}
            placeholder="Team name"
          />
        </div>
        <div className="te-field-row">
          <span className="te-field-label">Desc.</span>
          <input
            className="te-field-input"
            value={draft.description}
            onChange={(e) => updateDraft({ description: e.target.value })}
            placeholder="Description (optional)"
          />
        </div>
      </div>

      {/* Drag-and-drop split view */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
        <div className="te-split">
          {/* Left: available profiles */}
          <div className="te-available">
            <div className="te-available-header">Available Profiles</div>
            <div className="pl-search">
              <input
                type="text"
                className="pl-search-input"
                placeholder="Search..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <SortableContext items={filteredProfiles.map((p) => `avail-${p.name}`)} strategy={verticalListSortingStrategy}>
              <div className="te-available-list">
                {filteredProfiles.map((p) => (
                  <DraggableProfile key={p.name} profile={p} inTeam={memberProfileNames.has(p.name)} />
                ))}
              </div>
            </SortableContext>
          </div>

          {/* Right: team members */}
          <div className="te-members">
            <div className="te-members-header">
              Team Members ({draft.members.length})
            </div>
            <SortableContext items={draft.members.map((m) => `member-${m.profile}`)} strategy={verticalListSortingStrategy}>
              <div className="te-members-list">
                {draft.members.map((m) => (
                  <SortableMember
                    key={m.profile}
                    member={m}
                    profile={profiles.find((p) => p.name === m.profile)}
                    isBroken={brokenMembers.includes(m.profile)}
                    onRemove={() => handleRemoveMember(m.profile)}
                    onSetLead={() => handleSetLead(m.profile)}
                    onRoleChange={(v) => handleMemberField(m.profile, "role", v)}
                    onInstructionsChange={(v) => handleMemberField(m.profile, "instructions", v)}
                  />
                ))}
                <div className="te-drop-zone">Drag a profile here to add</div>
              </div>
            </SortableContext>
          </div>
        </div>

        <DragOverlay>
          {activeId ? (
            <div className="te-drag-overlay">
              {activeId.replace("avail-", "").replace("member-", "")}
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Merge preview modal */}
      {showMergePreview && mergeData && (
        <MergePreview data={mergeData} onClose={() => setShowMergePreview(false)} />
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <ConfirmDialog
          title={`Delete ${draft.name}?`}
          description="This team will be permanently deleted."
          confirmLabel="Delete"
          onConfirm={() => { setShowDeleteConfirm(false); onDelete(draft.name); }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </div>
  );
}
