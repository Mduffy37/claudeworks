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
  arrayMove,
} from "@dnd-kit/sortable";
import type { Team, TeamMember, Profile, MergePreview as MergePreviewType } from "../../electron/types";
import { MergePreview } from "./MergePreview";
import { ConfirmDialog } from "./shared/ConfirmDialog";
import { InfoCard } from "./profile/InfoCard";
import { DraggableProfile } from "./team/DraggableProfile";
import { SortableMember } from "./team/SortableMember";

interface Props {
  team: Team | null;
  profiles: Profile[];
  isNew: boolean;
  brokenMembers: string[];
  importedProjects?: string[];
  onSave: (team: Team) => void | Promise<void>;
  onDelete: (name: string) => void;
  dirty: boolean;
  onDirtyChange: (v: boolean) => void;
  onNavigateToProfile?: (name: string) => void;
}

export function TeamEditor({ team, profiles, isNew, brokenMembers, importedProjects = [], onSave, onDelete, dirty, onDirtyChange, onNavigateToProfile }: Props) {
  const [draft, setDraft] = useState<Team>({
    name: "",
    description: "",
    members: [],
  });
  const [showMergePreview, setShowMergePreview] = useState(false);
  const [mergeData, setMergeData] = useState<MergePreviewType | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [search, setSearch] = useState("");
  const [showOverflow, setShowOverflow] = useState(false);

  useEffect(() => {
    if (team) {
      setDraft({ ...team, members: team.members.map((m) => ({ ...m })) });
    } else if (isNew) {
      setDraft({ name: "", description: "", members: [] });
    }
    onDirtyChange(false);
    setShowMergePreview(false);
    setMergeData(null);
  }, [team, isNew, onDirtyChange]);

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
      // If dropped over a member, insert at that position
      if (overStr.startsWith("member-")) {
        const insertIndex = draft.members.findIndex((m) => `member-${m.profile}` === overStr);
        if (insertIndex !== -1) {
          const newMembers = [...draft.members];
          newMembers.splice(insertIndex, 0, newMember);
          updateDraft({ members: newMembers });
          return;
        }
      }
      updateDraft({ members: [...draft.members, newMember] });
      return;
    }

    // Dragging member back to available list = remove
    if (activeStr.startsWith("member-") && overStr.startsWith("avail-")) {
      const profileName = activeStr.replace("member-", "");
      handleRemoveMember(profileName);
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

  const handleSave = useCallback(async () => {
    if (!draft.name.trim()) return;
    await onSave(draft);
    onDirtyChange(false);
  }, [draft, onSave, onDirtyChange]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "s") {
        e.preventDefault();
        if (draft.name.trim() && dirty) handleSave();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [draft.name, dirty, handleSave]);

  const handlePreviewMerge = async () => {
    const preview = await window.api.getTeamMergePreview(draft);
    setMergeData(preview);
    setShowMergePreview(true);
  };

  if (!team && !isNew) {
    return (
      <div className="profile-editor empty">
        <div className="empty-state">
          <div className="empty-state-icon">&#9671;</div>
          <div className="empty-state-title">No team selected</div>
          <div className="empty-state-body">
            Choose a team from the sidebar, or create a new one to get started.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="te-editor">
      {/* Top bar — matches ProfileEditor layout */}
      <div className="pe-topbar">
        {/* Left: Name + subtitle, vertically centered */}
        <div className="pe-topbar-identity">
          <input
            className="pe-topbar-name-input"
            value={draft.name}
            onChange={(e) => updateDraft({ name: e.target.value })}
            placeholder={isNew ? "Team name..." : ""}
            autoFocus={isNew}
          />
          <span className="pe-topbar-subtitle">
            {draft.members.length} member{draft.members.length !== 1 ? "s" : ""}
          </span>
        </div>

        {/* Right: stacked controls */}
        <div className="pe-topbar-right">
          {/* Row 1: dir select + Launch — placeholder for now */}
          {!isNew && (
            <div className="pe-topbar-controls-row">
              <select className="pe-launch-dir-select" disabled>
                <option value="">None (choose at launch)</option>
                {importedProjects.map((dir) => (
                  <option key={dir} value={dir}>{dir.split("/").filter(Boolean).pop() ?? dir}</option>
                ))}
              </select>
              <button className="btn-launch" disabled title="Team launch coming soon">
                <span className="btn-launch-icon">
                  <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                    <path d="M3 7h8M8 4l3 3-3 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                Launch
              </button>
            </div>
          )}

          {/* Row 2: ... + Save */}
          <div className="pe-topbar-controls-row pe-topbar-controls-row-end">
            {!isNew && (
              <div className="pe-topbar-secondary">
                <button
                  className="pe-overflow-btn"
                  onClick={() => setShowOverflow(!showOverflow)}
                  title="More actions"
                  aria-label="More actions"
                >
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <circle cx="3" cy="8" r="1.3" fill="currentColor" />
                    <circle cx="8" cy="8" r="1.3" fill="currentColor" />
                    <circle cx="13" cy="8" r="1.3" fill="currentColor" />
                  </svg>
                </button>
                {showOverflow && (
                  <>
                    <div className="pe-overflow-backdrop" onClick={() => setShowOverflow(false)} />
                    <div className="pe-overflow-menu">
                      <button onClick={() => { setShowOverflow(false); handlePreviewMerge(); }} disabled={draft.members.length === 0}>
                        Preview Merge
                      </button>
                      <div className="pe-overflow-divider" />
                      <button className="pe-overflow-danger" onClick={() => { setShowOverflow(false); setShowDeleteConfirm(true); }}>
                        Delete Team
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}
            <button
              className="btn-primary"
              disabled={!draft.name.trim() || !dirty}
              onClick={handleSave}
            >
              {isNew ? "Create Team" : "Save"}
            </button>
          </div>
        </div>
      </div>

      {/* Description — collapsible, matches profile InfoCard */}
      <InfoCard
        description={draft.description}
        isNew={isNew}
        onChangeDescription={(v) => updateDraft({ description: v })}
      />

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
                    onNavigateToProfile={onNavigateToProfile}
                  />
                ))}
                <div className={`te-drop-zone${activeId ? " drag-active" : ""}`}>Drag a profile here to add</div>
              </div>
            </SortableContext>
          </div>
        </div>

        <DragOverlay>
          {activeId ? (() => {
            const name = activeId.replace("avail-", "").replace("member-", "");
            const p = profiles.find((pr) => pr.name === name);
            return (
              <div className="te-drag-overlay-card">
                <div className="te-avail-name">{name}</div>
                <div className="te-avail-meta">
                  {p ? `${p.plugins.length} plugin${p.plugins.length !== 1 ? "s" : ""}` : ""}
                </div>
              </div>
            );
          })() : null}
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
