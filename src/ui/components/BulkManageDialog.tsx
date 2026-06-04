import React, { useState, useEffect, useRef, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Profile, Team, PluginWithItems } from "../../electron/types";
import { ConfirmDialog } from "./shared/ConfirmDialog";

// ─── Translate known profile descriptions at display time ───────────────────

function translateDescription(desc: string, t: any): string {
  if (desc === "Your default profile. Running `claude` launches with these plugins and settings.") {
    return t("profile:descriptions.default");
  }
  if (desc === "Dedicated workspace for creating and managing ClaudeWorks profiles.") {
    return t("profile:descriptions.profileCreator");
  }
  return desc;
}

function ItemCheckbox({ checked, onChange, label }: { checked: boolean; onChange: () => void; label?: string }) {
  return (
    <div
      className={`item-checkbox${checked ? " checked" : ""}`}
      onClick={(e) => {
        e.preventDefault();
        onChange();
      }}
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onChange();
        }
      }}
    />
  );
}

type ManageTab = "profiles" | "teams";
type BulkAction = "none" | "delete" | "tags" | "projects" | "model" | "effort" | "plugin" | "auth";

interface Props {
  profiles: Profile[];
  teams: Team[];
  plugins: PluginWithItems[];
  importedProjects: string[];
  defaultTab: ManageTab;
  onUpdateProfile: (profile: Profile) => Promise<void>;
  onDeleteProfile: (name: string) => Promise<void>;
  onUpdateTeam: (team: Team) => Promise<void>;
  onDeleteTeam: (name: string) => Promise<void>;
  onClose: () => void;
}

function shortPath(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  return parts.length <= 1 ? dir : `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

export function BulkManageDialog({
  profiles,
  teams,
  plugins,
  importedProjects,
  defaultTab,
  onUpdateProfile,
  onDeleteProfile,
  onUpdateTeam,
  onDeleteTeam,
  onClose,
}: Props) {
  const { t } = useTranslation(["plugin", "common", "profile"]);
  const [activeTab, setActiveTab] = useState<ManageTab>(defaultTab);
  const [selectedProfiles, setSelectedProfiles] = useState<Set<string>>(new Set());
  const [selectedTeams, setSelectedTeams] = useState<Set<string>>(new Set());
  const [action, setAction] = useState<BulkAction>("none");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [applying, setApplying] = useState(false);

  // Action values
  const [tagInput, setTagInput] = useState("");
  const [tagMode, setTagMode] = useState<"add" | "remove">("add");
  const [projectValue, setProjectValue] = useState("");
  const [projectMode, setProjectMode] = useState<"add" | "remove">("add");
  const [modelValue, setModelValue] = useState("");
  const [effortValue, setEffortValue] = useState("");
  const [pluginName, setPluginName] = useState("");
  const [pluginMode, setPluginMode] = useState<"enable" | "disable">("enable");
  const [authValue, setAuthValue] = useState(true);

  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Reset selection and action when switching tabs
  useEffect(() => {
    setAction("none");
  }, [activeTab]);

  const selected = activeTab === "profiles" ? selectedProfiles : selectedTeams;
  const setSelected = activeTab === "profiles" ? setSelectedProfiles : setSelectedTeams;
  const items = activeTab === "profiles" ? profiles : teams;

  const allSelected = items.length > 0 && selected.size === items.length;

  const toggleItem = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(items.map((i) => i.name)));
    }
  };

  // Collect all existing tags for autocomplete
  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const p of profiles) {
      for (const t of p.tags ?? []) tags.add(t);
    }
    for (const t of teams) {
      for (const tag of t.tags ?? []) tags.add(tag);
    }
    return Array.from(tags).sort();
  }, [profiles, teams]);

  const tagSuggestions = useMemo(() => {
    const q = tagInput.toLowerCase().trim();
    if (!q) return allTags;
    return allTags.filter((t) => t.toLowerCase().includes(q));
  }, [tagInput, allTags]);

  const handleApply = async () => {
    if (selected.size === 0) return;
    setApplying(true);

    try {
      if (action === "delete") {
        setConfirmDelete(true);
        setApplying(false);
        return;
      }

      if (activeTab === "profiles") {
        for (const name of selected) {
          const profile = profiles.find((p) => p.name === name);
          if (!profile) continue;

          let updated = { ...profile };
          if (action === "tags") {
            const currentTags = updated.tags ?? [];
            if (tagMode === "add" && tagInput.trim()) {
              const tag = tagInput.trim();
              if (!currentTags.includes(tag)) {
                updated.tags = [...currentTags, tag];
              }
            } else if (tagMode === "remove" && tagInput.trim()) {
              updated.tags = currentTags.filter((t) => t !== tagInput.trim());
              if (updated.tags.length === 0) updated.tags = undefined;
            }
          } else if (action === "projects") {
            const currentProjects = updated.projects ?? [];
            if (projectMode === "add" && projectValue) {
              if (!currentProjects.includes(projectValue)) {
                updated.projects = [...currentProjects, projectValue];
              }
            } else if (projectMode === "remove" && projectValue) {
              updated.projects = currentProjects.filter((p) => p !== projectValue);
              if (updated.projects.length === 0) updated.projects = undefined;
            }
          } else if (action === "model") {
            updated.model = (modelValue || undefined) as Profile["model"];
          } else if (action === "effort") {
            updated.effortLevel = (effortValue || undefined) as Profile["effortLevel"];
          } else if (action === "plugin") {
            const currentPlugins = [...updated.plugins];
            if (pluginMode === "enable" && !currentPlugins.includes(pluginName)) {
              updated.plugins = [...currentPlugins, pluginName];
            } else if (pluginMode === "disable") {
              updated.plugins = currentPlugins.filter((p) => p !== pluginName);
            }
          } else if (action === "auth") {
            updated.useDefaultAuth = authValue;
          }

          await onUpdateProfile(updated);
        }
      } else {
        for (const name of selected) {
          const team = teams.find((t) => t.name === name);
          if (!team) continue;

          let updated = { ...team };
          if (action === "tags") {
            const currentTags = updated.tags ?? [];
            if (tagMode === "add" && tagInput.trim()) {
              const tag = tagInput.trim();
              if (!currentTags.includes(tag)) {
                updated.tags = [...currentTags, tag];
              }
            } else if (tagMode === "remove" && tagInput.trim()) {
              updated.tags = currentTags.filter((t) => t !== tagInput.trim());
              if (updated.tags.length === 0) updated.tags = undefined;
            }
          } else if (action === "projects") {
            const currentProjects = updated.projects ?? [];
            if (projectMode === "add" && projectValue) {
              if (!currentProjects.includes(projectValue)) {
                updated.projects = [...currentProjects, projectValue];
              }
            } else if (projectMode === "remove" && projectValue) {
              updated.projects = currentProjects.filter((p) => p !== projectValue);
              if (updated.projects.length === 0) updated.projects = undefined;
            }
          }
          await onUpdateTeam(updated);
        }
      }

      setAction("none");
      setTagInput("");
      setProjectValue("");
    } finally {
      setApplying(false);
    }
  };

  const handleConfirmDelete = async () => {
    setConfirmDelete(false);
    setApplying(true);
    try {
      if (activeTab === "profiles") {
        for (const name of selected) {
          await onDeleteProfile(name);
        }
        setSelectedProfiles(new Set());
      } else {
        for (const name of selected) {
          await onDeleteTeam(name);
        }
        setSelectedTeams(new Set());
      }
      setAction("none");
    } finally {
      setApplying(false);
    }
  };

  const profileActions: { value: BulkAction; label: string }[] = [
    { value: "none", label: t("bulk.chooseAction") },
    { value: "delete", label: t("bulk.deleteSelected") },
    { value: "tags", label: t("bulk.manageTags") },
    { value: "projects", label: t("bulk.manageProjects") },
    { value: "model", label: t("bulk.setModel") },
    { value: "effort", label: t("bulk.setEffort") },
    { value: "plugin", label: t("bulk.togglePlugin") },
    { value: "auth", label: t("bulk.toggleAuth") },
  ];

  const teamActions: { value: BulkAction; label: string }[] = [
    { value: "none", label: t("bulk.chooseAction") },
    { value: "delete", label: t("bulk.deleteSelected") },
    { value: "tags", label: t("bulk.manageTags") },
    { value: "projects", label: t("bulk.manageProjects") },
  ];

  const actions = activeTab === "profiles" ? profileActions : teamActions;

  const canApply = action !== "none" && selected.size > 0 && !applying && (
    action === "delete" ||
    (action === "tags" && tagInput.trim()) ||
    (action === "projects" && projectValue) ||
    (action === "model") ||
    (action === "effort") ||
    (action === "plugin" && pluginName) ||
    (action === "auth")
  );

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="manage-dialog bulk-manage-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Manage"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="manage-dialog-header">
          <div className="manage-dialog-tabs">
            <button
              className={`manage-dialog-tab${activeTab === "profiles" ? " active" : ""}`}
              onClick={() => setActiveTab("profiles")}
            >
              {t("bulk.profiles", { count: profiles.length })}
            </button>
            <button
              className={`manage-dialog-tab${activeTab === "teams" ? " active" : ""}`}
              onClick={() => setActiveTab("teams")}
            >
              {t("bulk.teams", { count: teams.length })}
            </button>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Item list — table semantics so the surface isn't one giant onClick */}
        <div className="bulk-item-list">
          {items.length === 0 ? (
            <div className="bulk-empty">
              {t("bulk.noItems", { type: activeTab })}
            </div>
          ) : (
            <table className="bulk-item-table">
              <thead>
                <tr>
                  <th scope="col" className="bulk-col-check" aria-label="Select" />
                  <th scope="col" className="bulk-col-name">{t("bulk.name")}</th>
                  <th scope="col" className="bulk-col-meta">
                    {activeTab === "profiles" ? t("bulk.modelEffortPlugins") : t("bulk.members")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const isSelected = selected.has(item.name);
                  const tags = (item as any).tags as string[] | undefined;
                  const countLabel = activeTab === "profiles"
                    ? t("common:plurals.plugin", { count: (item as Profile).plugins.length })
                    : t("common:plurals.member", { count: (item as Team).members.length });
                  const checkboxLabel = `Select ${item.name} (${countLabel})`;
                  return (
                    <tr
                      key={item.name}
                      className={`bulk-item${isSelected ? " selected" : ""}`}
                      onClick={() => toggleItem(item.name)}
                    >
                      <td className="bulk-col-check">
                        <ItemCheckbox checked={isSelected} onChange={() => toggleItem(item.name)} label={checkboxLabel} />
                      </td>
                      <td className="bulk-col-name">
                        <div className="bulk-item-info">
                          <span className="bulk-item-name">{item.name}</span>
                          {item.description && (
                            <span className="bulk-item-desc">{translateDescription(item.description, t)}</span>
                          )}
                          {tags && tags.length > 0 && (
                            <span className="bulk-item-tags">
                              {tags.map((t) => (
                                <span key={t} className="bulk-tag-chip">{t}</span>
                              ))}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="bulk-col-meta">
                        <div className="bulk-item-meta">
                          {activeTab === "profiles" ? (
                            <>
                              {(item as Profile).model && <span className="bulk-meta-badge">{(item as Profile).model}</span>}
                              {(item as Profile).effortLevel && <span className="bulk-meta-badge">{(item as Profile).effortLevel}</span>}
                              {(item as Profile).plugins.length > 0 && (
                                <span className="bulk-meta-badge">{t("common:plurals.plugin_other", { count: (item as Profile).plugins.length })}</span>
                              )}
                            </>
                          ) : (
                            <span className="bulk-meta-badge">{t("common:plurals.member_other", { count: (item as Team).members.length })}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Sticky footer — bulk-action bar lives here so Close stays top-right
            and the apply controls are anchored where users expect commit-style
            dialog actions. */}
        <div className="bulk-action-bar bulk-action-footer">
          <div className="bulk-select-all" onClick={toggleAll}>
            <ItemCheckbox checked={allSelected} onChange={toggleAll} label={t("common:buttons.selectAll")} />
            <span className="bulk-select-label">
              {selected.size > 0 ? (
                t("bulk.selected", { count: selected.size, type: activeTab === "profiles" ? t("common:plurals.profile", { count: selected.size }) : t("common:plurals.team", { count: selected.size }) })
              ) : (
                t("common:buttons.selectAll")
              )}
            </span>
          </div>

          <div className="bulk-action-controls">
            <select
              value={action}
              onChange={(e) => setAction(e.target.value as BulkAction)}
              disabled={selected.size === 0}
              aria-label="Bulk action"
            >
              {actions.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>

            {/* Action-specific controls */}
            {action === "tags" && (
              <div className="bulk-action-inline">
                <select value={tagMode} onChange={(e) => setTagMode(e.target.value as "add" | "remove")} aria-label="Tag mode">
                  <option value="add">{t("bulk.addTag")}</option>
                  <option value="remove">{t("bulk.removeTag")}</option>
                </select>
                <div className="bulk-tag-input-wrap">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    placeholder={t("bulk.tagNamePlaceholder")}
                    list="bulk-tag-suggestions"
                    aria-label="Tag name"
                    onKeyDown={(e) => { if (e.key === "Enter" && canApply) handleApply(); }}
                  />
                  <datalist id="bulk-tag-suggestions">
                    {tagSuggestions.map((t) => (
                      <option key={t} value={t} />
                    ))}
                  </datalist>
                </div>
              </div>
            )}

            {action === "projects" && (
              <div className="bulk-action-inline">
                <select value={projectMode} onChange={(e) => setProjectMode(e.target.value as "add" | "remove")} aria-label="Project mode">
                  <option value="add">{t("bulk.addProject")}</option>
                  <option value="remove">{t("bulk.removeProject")}</option>
                </select>
                <select value={projectValue} onChange={(e) => setProjectValue(e.target.value)} aria-label="Project">
                  <option value="">{importedProjects.length === 0 ? t("bulk.noImportedProjects") : t("bulk.chooseProject")}</option>
                  {importedProjects.map((p) => (
                    <option key={p} value={p}>{shortPath(p)}</option>
                  ))}
                </select>
              </div>
            )}

            {action === "model" && (
              <select value={modelValue} onChange={(e) => setModelValue(e.target.value)} aria-label="Model">
                <option value="">{t("bulk.defaultClear")}</option>
                <option value="opus">Opus</option>
                <option value="sonnet">Sonnet</option>
                <option value="haiku">Haiku</option>
              </select>
            )}

            {action === "effort" && (
              <select value={effortValue} onChange={(e) => setEffortValue(e.target.value)} aria-label="Effort level">
                <option value="">{t("bulk.defaultClear")}</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="xhigh">X-High</option>
                <option value="max">Max</option>
              </select>
            )}

            {action === "plugin" && (
              <div className="bulk-action-inline">
                <select value={pluginMode} onChange={(e) => setPluginMode(e.target.value as "enable" | "disable")} aria-label="Plugin mode">
                  <option value="enable">{t("bulk.enable")}</option>
                  <option value="disable">{t("bulk.disable")}</option>
                </select>
                <select value={pluginName} onChange={(e) => setPluginName(e.target.value)} aria-label="Plugin">
                  <option value="">{t("bulk.choosePlugin")}</option>
                  {plugins.map((p) => (
                    <option key={p.name} value={p.name}>{p.pluginName}</option>
                  ))}
                </select>
              </div>
            )}

            {action === "auth" && (
              <select value={authValue ? "true" : "false"} onChange={(e) => setAuthValue(e.target.value === "true")} aria-label="Auth mode">
                <option value="true">{t("bulk.useDefaultAuth")}</option>
                <option value="false">{t("bulk.separateAuth")}</option>
              </select>
            )}

            <button
              className="btn-primary"
              disabled={!canApply}
              onClick={handleApply}
            >
              {applying ? t("bulk.applying") : t("bulk.apply")}
            </button>
          </div>
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={t("bulk.deleteConfirm", { count: selected.size, type: activeTab === "profiles" ? "profile" : "team" })}
          description={t("bulk.deleteDescription", { names: Array.from(selected).join(", ") })}
          confirmLabel={t("common:buttons.delete")}
          onConfirm={handleConfirmDelete}
          onCancel={() => { setConfirmDelete(false); setApplying(false); }}
        />
      )}
    </div>
  );
}
