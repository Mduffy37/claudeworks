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

interface Props {
  team: Team | null;
  profiles: Profile[];
  isNew: boolean;
  brokenMembers: string[];
  onSave: (team: Team) => void;
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
  const [showSettings, setShowSettings] = useState(false);
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
    setShowSettings(false);
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

  const handleSave = () => {
    if (!draft.name.trim()) return;
    onSave(draft);
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

  const leadMember = draft.members.find((m) => m.isLead);

  return (
    <div className="te-editor">
      {/* Top bar */}
      <div className="te-topbar">
        <div className="te-topbar-left">
          <input
            className="te-name-input"
            value={draft.name}
            onChange={(e) => updateDraft({ name: e.target.value })}
            placeholder="Team name"
          />
          <input
            className="te-desc-input"
            value={draft.description}
            onChange={(e) => updateDraft({ description: e.target.value })}
            placeholder="Description"
          />
        </div>
        <div className="te-topbar-actions">
          <button className="btn-update" onClick={handlePreviewMerge} disabled={draft.members.length === 0}>
            Preview Merge
          </button>
          <button className="btn-uninstall" disabled title="Coming soon" style={{ cursor: "not-allowed" }}>
            Launch &#x1f512;
          </button>
          <button className="btn-icon" onClick={() => setShowSettings(!showSettings)} title="Settings">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M6.5 1.5h3L10 3.4a5 5 0 011.2.7l1.8-.7 1.5 2.6-1.3 1.3a5 5 0 010 1.4l1.3 1.3-1.5 2.6-1.8-.7a5 5 0 01-1.2-.7l-.5 1.9h-3L6 12.6a5 5 0 01-1.2-.7l-1.8.7L1.5 10l1.3-1.3a5 5 0 010-1.4L1.5 6l1.5-2.6 1.8.7A5 5 0 016 3.4l.5-1.9z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" fill="none" />
              <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
          {dirty && (
            <button className="btn-primary" onClick={handleSave}>Save</button>
          )}
          {!isNew && (
            <button className="btn-icon te-delete-btn" onClick={() => setShowDeleteConfirm(true)} title="Delete team">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && (
        <div className="te-settings">
          <div className="te-settings-row">
            <span className="te-field-label">Model</span>
            <select
              className="te-field-input"
              value={draft.model ?? ""}
              onChange={(e) => updateDraft({ model: (e.target.value || undefined) as Team["model"] })}
            >
              <option value="">{leadMember ? `Inherit from ${leadMember.profile}` : "Default"}</option>
              <option value="opus">Opus</option>
              <option value="sonnet">Sonnet</option>
              <option value="haiku">Haiku</option>
            </select>
          </div>
          <div className="te-settings-row">
            <span className="te-field-label">Effort</span>
            <select
              className="te-field-input"
              value={draft.effortLevel ?? ""}
              onChange={(e) => updateDraft({ effortLevel: (e.target.value || undefined) as Team["effortLevel"] })}
            >
              <option value="">{leadMember ? `Inherit from ${leadMember.profile}` : "Default"}</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="max">Max</option>
            </select>
          </div>
          <div className="te-settings-row">
            <span className="te-field-label">Flags</span>
            <input
              className="te-field-input"
              value={draft.customFlags ?? ""}
              onChange={(e) => updateDraft({ customFlags: e.target.value || undefined })}
              placeholder={leadMember ? `Inherit from ${leadMember.profile}` : "Custom flags"}
            />
          </div>
        </div>
      )}

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
        <div className="modal-backdrop" onClick={() => setShowDeleteConfirm(false)}>
          <div className="modal-dialog modal-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Delete {draft.name}?</span>
              <button className="modal-close" onClick={() => setShowDeleteConfirm(false)}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-description">This team will be permanently deleted.</p>
              <div className="modal-confirm-actions">
                <button className="btn-secondary" onClick={() => setShowDeleteConfirm(false)}>Cancel</button>
                <button className="btn-danger" onClick={() => { setShowDeleteConfirm(false); onDelete(draft.name); }}>Delete</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
