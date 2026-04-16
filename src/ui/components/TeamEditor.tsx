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
import type { Team, TeamMember, Profile, MergePreview as MergePreviewType, LaunchOptions } from "../../electron/types";
import { MergePreview } from "./MergePreview";
import { ConfirmDialog } from "./shared/ConfirmDialog";
import { InfoCard } from "./profile/InfoCard";
import { TagsProjectsEditor } from "./shared/TagsProjectsEditor";
import { DraggableProfile } from "./team/DraggableProfile";
import { SortableMember } from "./team/SortableMember";
import { EditorTopBar } from "./shared/EditorTopBar";

interface Props {
  team: Team | null;
  profiles: Profile[];
  isNew: boolean;
  brokenMembers: string[];
  importedProjects?: string[];
  tagSuggestions?: string[];
  onSave: (team: Team) => void | Promise<void>;
  onDelete: (name: string) => void;
  onLaunch: (name: string, directory?: string) => void;
  onOpenProjectsConfig?: () => void;
  focusTagsSignal?: number;
  focusProjectsSignal?: number;
  dirty: boolean;
  onDirtyChange: (v: boolean) => void;
  onNavigateToProfile?: (name: string) => void;
}

export function TeamEditor({ team, profiles, isNew, brokenMembers, importedProjects = [], tagSuggestions = [], onSave, onDelete, onLaunch, onOpenProjectsConfig, focusTagsSignal, focusProjectsSignal, dirty, onDirtyChange, onNavigateToProfile }: Props) {
  const [draft, setDraft] = useState<Team>({
    name: "",
    description: "",
    members: [],
  });
  const [showMergePreview, setShowMergePreview] = useState(false);
  const [mergeData, setMergeData] = useState<MergePreviewType | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [search, setSearch] = useState("");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");
  const [launchDir, setLaunchDir] = useState("");

  // Persist launch dir per team (shared with TeamList sidebar dropdown).
  useEffect(() => {
    if (!team?.name) {
      setLaunchDir("");
      return;
    }
    const stored = window.localStorage.getItem(`teamLaunchDir:${team.name}`);
    setLaunchDir(stored && importedProjects.includes(stored) ? stored : "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team?.name, importedProjects.join("|")]);

  const updateLaunchDir = (dir: string) => {
    setLaunchDir(dir);
    if (!team?.name) return;
    const key = `teamLaunchDir:${team.name}`;
    if (dir) window.localStorage.setItem(key, dir);
    else window.localStorage.removeItem(key);
  };
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);

  const handleLaunchWithOptions = async (options: LaunchOptions) => {
    const lead = draft.members.find((m) => m.isLead);
    if (!lead) return;
    if (dirty) await onSave(draft);

    let dir = launchDir || undefined;
    if (!dir) {
      const picked = await window.api.selectDirectory();
      if (!picked) return;
      dir = picked;
    }

    setLaunching(true);
    setLaunchError(null);
    try {
      await window.api.launchTeamWithOptions(draft, dir, options);
    } catch (err: any) {
      setLaunchError(err?.message ?? "Team launch failed");
    } finally {
      setLaunching(false);
    }
  };

  const handleLaunch = async () => {
    const lead = draft.members.find((m) => m.isLead);
    if (!lead) return;
    if (dirty) await onSave(draft);

    let dir = launchDir || undefined;
    if (!dir) {
      const picked = await window.api.selectDirectory();
      if (!picked) return;
      dir = picked;
    }

    setLaunching(true);
    setLaunchError(null);
    try {
      await window.api.launchTeam(draft, dir);
    } catch (err: any) {
      setLaunchError(err?.message ?? "Team launch failed");
    } finally {
      setLaunching(false);
    }
  };

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

  const handleAddMember = (profileName: string) => {
    if (memberProfileNames.has(profileName)) return;
    const newMember: TeamMember = {
      profile: profileName,
      role: "",
      instructions: "",
      isLead: draft.members.length === 0,
    };
    updateDraft({ members: [...draft.members, newMember] });
  };

  const handleSetLead = (profileName: string) => {
    updateDraft({
      members: draft.members.map((m) => ({
        ...m,
        isLead: m.profile === profileName,
      })),
    });
  };

  const handleMemberField = (profileName: string, field: "role" | "instructions" | "colour", value: string) => {
    const resolved = field === "colour" ? (value || undefined) : value;
    updateDraft({
      members: draft.members.map((m) =>
        m.profile === profileName ? { ...m, [field]: resolved } : m
      ),
    });
  };

  const handleSave = useCallback(async () => {
    if (!draft.name.trim()) return;
    await onSave(draft);
    onDirtyChange(false);
    setSaveStatus("saved");
    setTimeout(() => setSaveStatus("idle"), 1500);
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
      {/* Top bar — shared with ProfileEditor */}
      <EditorTopBar
        isNew={isNew}
        name={draft.name}
        dirty={dirty}
        saving={false}
        saveStatus={saveStatus}
        subtitle={`${draft.members.length} member${draft.members.length !== 1 ? "s" : ""}`}
        createLabel="Create Team"
        namePlaceholder="Team name..."
        directories={importedProjects}
        launchDir={launchDir}
        launching={launching}
        importedProjectsCount={importedProjects.length}
        onOpenProjectsConfig={onOpenProjectsConfig}
        onChangeName={(v) => updateDraft({ name: v })}
        markDirty={markDirty}
        onSetLaunchDir={updateLaunchDir}
        onSave={handleSave}
        onLaunch={handleLaunch}
        onLaunchWithOptions={handleLaunchWithOptions}
        overflowMenu={team ? (close: () => void) => (
          <>
            <button role="menuitem" type="button" onClick={() => { close(); handlePreviewMerge(); }} disabled={draft.members.length === 0}>
              Preview Merge
            </button>
            <div className="pe-overflow-divider" role="separator" />
            <button role="menuitem" type="button" className="pe-overflow-danger" onClick={() => { close(); setShowDeleteConfirm(true); }}>
              Delete Team
            </button>
          </>
        ) : undefined}
      />

      {launchError && (
        <div className="pe-error-banner">
          <span>{launchError}</span>
          <button onClick={() => setLaunchError(null)}>&times;</button>
        </div>
      )}

      {/* Description — collapsible, matches profile InfoCard */}
      <InfoCard
        description={draft.description}
        isNew={isNew}
        onChangeDescription={(v) => updateDraft({ description: v })}
      />

      <TagsProjectsEditor
        tags={draft.tags ?? []}
        projects={draft.projects ?? []}
        tagSuggestions={tagSuggestions}
        importedProjects={importedProjects}
        onChangeTags={(v) => updateDraft({ tags: v.length > 0 ? v : undefined })}
        onChangeProjects={(v) => updateDraft({ projects: v.length > 0 ? v : undefined })}
        onOpenProjectsConfig={() => onOpenProjectsConfig?.()}
        focusTagsSignal={focusTagsSignal}
        focusProjectsSignal={focusProjectsSignal}
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
                  <DraggableProfile key={p.name} profile={p} inTeam={memberProfileNames.has(p.name)} onAdd={() => handleAddMember(p.name)} />
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
                    onColourChange={(v) => handleMemberField(m.profile, "colour", v ?? "")}
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
