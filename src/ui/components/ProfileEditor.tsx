import React, { useState, useMemo, useEffect, useRef } from "react";
import type {
  Profile,
  PluginWithItems,
  PluginItem,
  StandaloneMcp,
  LaunchOptions,
} from "../../../src/electron/types";
import { PluginPicker } from "./PluginPicker";
import { ConfirmDialog } from "./shared/ConfirmDialog";
import { FilterBar, type FilterOption, type SortOption } from "./shared/FilterBar";
import { useProfileDraft, type TabId } from "../hooks/useProfileDraft";
import { usePluginToggles } from "../hooks/usePluginToggles";
import { ProfileTopBar } from "./profile/ProfileTopBar";
import { InfoCard } from "./profile/InfoCard";
import { TagsProjectsEditor } from "./shared/TagsProjectsEditor";
import { PromptPicker } from "./PromptPicker";
import { McpTab } from "./profile/McpTab";
import { SettingsTab } from "./profile/SettingsTab";

// Convert kebab-case plugin slugs to Title Case display names.
// e.g. "accessibility-compliance" → "Accessibility Compliance"
function formatPluginTitle(slug: string): string {
  return slug
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ─── Types ─────────────────────────────────────────────────────────────────

interface Props {
  profile: Profile | null;
  plugins: PluginWithItems[];
  isNew: boolean;
  brokenPlugins: string[];
  importedProjects?: string[];
  tagSuggestions?: string[];
  onSave: (profile: Profile) => void;
  onLaunch: (name: string, directory?: string) => void;
  onDelete: (name: string) => void;
  onDuplicate?: (name: string) => void;
  onOpenProjectsConfig?: () => void;
  /** Opens the Configure Claude dialog at Plugins > Browse with the query pre-filled. */
  onOpenBrowseAt?: (query: string) => void;
  focusTagsSignal?: number;
  focusProjectsSignal?: number;
  dirty: boolean;
  onDirtyChange: (v: boolean) => void;
  onRegisterSave?: (fn: () => Promise<void> | void) => void;
}

// ─── Overview modal ──────────────────────────────────────────────────────────

type OverviewCategory = "plugins" | "skills" | "agents" | "commands" | "mcps" | null;

function OverviewModal({
  overview,
  excludedItems,
  model,
  effortLevel,
  customClaudeMd,
  onClose,
  onJumpToTab,
}: {
  overview: {
    enabledPlugins: PluginWithItems[];
    skills: PluginItem[];
    agents: PluginItem[];
    commands: PluginItem[];
    pluginMcps: { name: string }[];
    standaloneMcps: StandaloneMcp[];
    flags: string[];
  };
  excludedItems: Record<string, string[]>;
  model: string;
  effortLevel: string;
  customClaudeMd: string;
  onClose: () => void;
  onJumpToTab?: (tab: TabId) => void;
}) {
  const [expanded, setExpanded] = useState<OverviewCategory>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const categoryToTab: Record<NonNullable<OverviewCategory>, TabId> = {
    plugins: "plugins",
    skills: "skills",
    agents: "agents",
    commands: "commands",
    mcps: "mcp",
  };

  const handleStatClick = (cat: OverviewCategory) => {
    if (!cat) return;
    if (onJumpToTab) {
      onJumpToTab(categoryToTab[cat]);
      return;
    }
    setExpanded((prev) => prev === cat ? null : cat);
  };

  const stats: { key: OverviewCategory; label: string; count: number }[] = [
    { key: "plugins", label: "Plugins", count: overview.enabledPlugins.length },
    { key: "skills", label: "Skills", count: overview.skills.length },
    { key: "agents", label: "Agents", count: overview.agents.length },
    { key: "commands", label: "Commands", count: overview.commands.length },
    { key: "mcps", label: "MCP Servers", count: overview.pluginMcps.length + overview.standaloneMcps.length },
  ];

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-dialog modal-dialog--overview" role="dialog" aria-modal="true" aria-label="Profile Overview" ref={dialogRef} tabIndex={-1}>
        <div className="modal-header">
          <span className="modal-title">Profile Overview</span>
          <button className="modal-close" onClick={onClose} aria-label="Close overview">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-description">
            Summary of what this profile will load when launched. Click a category to see details.
          </p>
          <div className="overview-grid">
            {stats.map((s) => (
              <button
                key={s.key}
                className={`overview-stat${expanded === s.key ? " expanded" : ""}`}
                onClick={() => handleStatClick(s.key)}
                title={onJumpToTab ? `Jump to ${s.label} tab` : undefined}
              >
                <div className="overview-stat-value">{s.count}</div>
                <div className="overview-stat-label">{s.label}</div>
              </button>
            ))}
          </div>

          {expanded === "plugins" && overview.enabledPlugins.length > 0 && (
            <div className="overview-section">
              <div className="overview-section-label">Enabled Plugins</div>
              <div className="overview-list">
                {overview.enabledPlugins.map((p) => (
                  <div key={p.name} className="overview-list-item">
                    <span>{p.pluginName}</span>
                    <span className="overview-list-meta">
                      {p.items.filter((i) => !(excludedItems[p.name] ?? []).includes(i.name)).length} items
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {expanded === "skills" && overview.skills.length > 0 && (
            <div className="overview-section">
              <div className="overview-section-label">Enabled Skills</div>
              <div className="overview-list">
                {overview.skills.map((i) => (
                  <div key={i.name} className="overview-list-item">
                    <span>{i.name}</span>
                    <span className="overview-list-meta">{i.plugin.split("@")[0]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {expanded === "agents" && overview.agents.length > 0 && (
            <div className="overview-section">
              <div className="overview-section-label">Enabled Agents</div>
              <div className="overview-list">
                {overview.agents.map((i) => (
                  <div key={i.name} className="overview-list-item">
                    <span>{i.name}</span>
                    <span className="overview-list-meta">{i.plugin.split("@")[0]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {expanded === "commands" && overview.commands.length > 0 && (
            <div className="overview-section">
              <div className="overview-section-label">Enabled Commands</div>
              <div className="overview-list">
                {overview.commands.map((i) => (
                  <div key={i.name} className="overview-list-item">
                    <span>/{i.name}</span>
                    <span className="overview-list-meta">{i.plugin.split("@")[0]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {expanded === "mcps" && (overview.pluginMcps.length + overview.standaloneMcps.length) > 0 && (
            <div className="overview-section">
              <div className="overview-section-label">Enabled MCP Servers</div>
              <div className="overview-list">
                {[...overview.pluginMcps, ...overview.standaloneMcps].map((m) => (
                  <div key={m.name} className="overview-list-item">
                    <span>{m.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {model && (
            <div className="overview-section">
              <div className="overview-section-label">Settings</div>
              <div className="overview-list">
                {model && <div className="overview-list-item"><span>Model: {model}</span></div>}
                {effortLevel && <div className="overview-list-item"><span>Effort: {effortLevel}</span></div>}
              </div>
            </div>
          )}

          {overview.flags.length > 0 && (
            <div className="overview-section">
              <div className="overview-section-label">Launch Flags</div>
              <div className="overview-list">
                {overview.flags.map((f) => (
                  <div key={f} className="overview-list-item"><code>{f}</code></div>
                ))}
              </div>
            </div>
          )}

          {customClaudeMd && (
            <div className="overview-section">
              <div className="overview-section-label">Instructions</div>
              <div className="overview-instructions-preview">{customClaudeMd}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tab bar ─────────────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string }[] = [
  { id: "plugins", label: "Plugins" },
  { id: "skills", label: "Skills" },
  { id: "agents", label: "Agents" },
  { id: "commands", label: "Commands" },
  { id: "mcp", label: "MCP Servers" },
  { id: "local", label: "Project Items" },
  { id: "instructions", label: "Instructions" },
  { id: "settings", label: "Settings" },
];

function TabBar({
  active,
  counts,
  onChange,
}: {
  active: TabId;
  counts: Partial<Record<TabId, string>>;
  onChange: (id: TabId) => void;
}) {
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const idx = TABS.findIndex((t) => t.id === active);
    let next = idx;
    if (e.key === "ArrowLeft") next = (idx - 1 + TABS.length) % TABS.length;
    else if (e.key === "ArrowRight") next = (idx + 1) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    const nextId = TABS[next].id;
    onChange(nextId);
    tabRefs.current[nextId]?.focus();
  };
  return (
    <div className="pe-tab-bar" role="tablist" aria-label="Profile sections" onKeyDown={onKeyDown}>
      {TABS.map((tab) => {
        const count = counts[tab.id];
        const selected = active === tab.id;
        return (
          <button
            key={tab.id}
            ref={(el) => { tabRefs.current[tab.id] = el; }}
            id={`pe-tab-${tab.id}`}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={`pe-tabpanel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            className={`pe-tab${selected ? " active" : ""}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
            {count !== undefined && (
              <span className="pe-tab-count">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Main editor ──────────────────────────────────────────────────────────────

export function ProfileEditor({ profile, plugins, isNew, brokenPlugins, importedProjects = [], tagSuggestions = [], onSave, onLaunch, onDelete, onDuplicate, onOpenProjectsConfig, onOpenBrowseAt, focusTagsSignal, focusProjectsSignal, dirty, onDirtyChange, onRegisterSave }: Props) {
  const draft = useProfileDraft({ profile, isNew, importedProjects, onSave, dirty, onDirtyChange });

  // Register the editor's save function so the sidebar can trigger it
  useEffect(() => {
    onRegisterSave?.(draft.handleSave);
  }, [draft.handleSave, onRegisterSave]);

  const [favouritePlugins, setFavouritePlugins] = useState<string[]>([]);

  useEffect(() => {
    window.api.getFavouritePlugins().then(setFavouritePlugins);
  }, []);

  const handleToggleFavourite = async (pluginName: string) => {
    const next = favouritePlugins.includes(pluginName)
      ? favouritePlugins.filter((n) => n !== pluginName)
      : [...favouritePlugins, pluginName];
    setFavouritePlugins(next);
    await window.api.saveFavouritePlugins(next);
  };

  const [itemSearch, setItemSearch] = useState("");
  const [itemFilter, setItemFilter] = useState<FilterOption>("all");
  const [promptPickerTarget, setPromptPickerTarget] = useState<null | "instructions" | "workflow">(null);
  const [itemSort, setItemSort] = useState<SortOption>("source");

  // ─── Inline item editor ─────────────────────────────────────────────────────
  const itemRelativePath = (type: string, name: string): string => {
    if (type === "skill") return `.claude/skills/${name}/SKILL.md`;
    if (type === "agent") return `.claude/agents/${name}.md`;
    return `.claude/commands/${name}.md`;
  };

  const [editingItem, setEditingItem] = useState<{ directory: string; relativePath: string; absolutePath: string; name: string; type: string } | null>(null);
  const [editingContent, setEditingContent] = useState("");
  const [editingDirty, setEditingDirty] = useState(false);

  const handleOpenItemEditor = async (item: { name: string; type: string; path: string }) => {
    if (!launchDir) return;
    const relPath = itemRelativePath(item.type, item.name);
    try {
      const content = await window.api.readProjectFile(launchDir, relPath);
      setEditingItem({ directory: launchDir, relativePath: relPath, absolutePath: item.path, name: item.name, type: item.type });
      setEditingContent(content);
      setEditingDirty(false);
    } catch {
      window.api.openInFinder(item.path);
    }
  };

  const handleSaveEditingItem = async () => {
    if (!editingItem) return;
    await window.api.writeProjectFile(editingItem.directory, editingItem.relativePath, editingContent);
    setEditingDirty(false);
  };

  const handleCloseEditor = () => {
    setEditingItem(null);
    setEditingContent("");
    setEditingDirty(false);
  };

  useEffect(() => {
    if (!editingItem) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") handleCloseEditor();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [editingItem]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // Set when the user clicks "Add plugin" on a missing-plugin banner row and
  // we couldn't find the plugin in any curated marketplace. Triggers the
  // not-found ConfirmDialog which asks whether to remove it from the profile.
  const [missingNotFoundPluginId, setMissingNotFoundPluginId] = useState<string | null>(null);
  const [missingLookupBusy, setMissingLookupBusy] = useState<string | null>(null);
  const toggleGroup = (name: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // Remove a single missing plugin id from the profile's plugin list.
  // Used by both the per-row "Remove" button on the missing banner and by
  // the "Remove from profile" confirmation after a failed curated lookup.
  const removeOneMissingPlugin = (pluginId: string) => {
    const cleaned = draft.selectedPlugins.filter((p) => p !== pluginId);
    draft.setSelectedPlugins(cleaned);
    onDirtyChange(true);
  };

  // "Add plugin" handler for a missing-plugin row. Looks up the plugin in the
  // curated index; if found, asks the parent to open Configure Claude at the
  // Browse sub-tab pre-searched for the plugin name. If not found (or the
  // index fails to load), surfaces the not-found confirm dialog.
  const handleAddMissingPlugin = async (pluginId: string) => {
    if (missingLookupBusy) return;
    const shortName = pluginId.split("@")[0];
    const marketplaceId = pluginId.includes("@") ? pluginId.split("@")[1] : undefined;
    setMissingLookupBusy(pluginId);
    try {
      const index = await window.api.getCuratedIndex();
      const match = index.entries.find((e) => {
        if (e.kind !== "plugin") return false;
        if (e.id !== shortName && e.id !== pluginId) return false;
        if (marketplaceId && e.path[0] && e.path[0] !== marketplaceId) return false;
        return true;
      });
      if (match && onOpenBrowseAt) {
        onOpenBrowseAt(shortName);
      } else {
        setMissingNotFoundPluginId(pluginId);
      }
    } catch {
      // Curated index failed to load — treat as "not found" so the user can
      // still decide to remove the plugin rather than being stuck.
      setMissingNotFoundPluginId(pluginId);
    } finally {
      setMissingLookupBusy(null);
    }
  };

  const {
    name, setName,
    description, setDescription,
    directories, setDirectories,
    alias, setAlias,
    isDefault, setIsDefault,
    selectedPlugins, setSelectedPlugins,
    excludedItems, setExcludedItems,
    localItems,
    mcpServers,
    model, setModel,
    opusContext, setOpusContext,
    sonnetContext, setSonnetContext,
    effortLevel, setEffortLevel,
    voiceEnabled, setVoiceEnabled,
    customClaudeMd, setCustomClaudeMd,
    workflow, setWorkflow,
    activeTab, setActiveTab,
    overviewOpen, setOverviewOpen,
    launching, setLaunching,
    launchError, setLaunchError,
    launchDir, setLaunchDir,
    binInPath, setBinInPath,
    confirmDelete, setConfirmDelete,
    disabledMcpServers, setDisabledMcpServers,
    launchFlags, setLaunchFlags,
    customFlags, setCustomFlags,
    useDefaultAuth, setUseDefaultAuth,
    env, setEnv,
    disabledHooks, setDisabledHooks,
    statusLineConfig, setStatusLineConfig,
    tags, setTags,
    projects, setProjects,
    saving,
    saveStatus,
    handleSave,
    handleToggleMcp,
    markDirty,
  } = draft;

  const { handleTogglePlugin, handleToggleItem, handleEnablePluginWithOnly, handleToggleGroup } =
    usePluginToggles({
      plugins,
      selectedPlugins,
      setSelectedPlugins,
      excludedItems,
      setExcludedItems,
      markDirty,
    });

  // ─── Launch ─────────────────────────────────────────────────────────────────

  const handleLaunch = async () => {
    if (!profile) return;
    setLaunchError(null);
    setLaunching(true);
    try {
      if (dirty) {
        try {
          await handleSave();
        } catch (err: any) {
          setLaunchError(`Save failed: ${err?.message ?? "Unknown error"}`);
          setLaunching(false);
          return;
        }
      }
      let dir = launchDir || undefined;
      if (!dir) {
        const picked = await window.api.selectDirectory();
        if (!picked) { setLaunching(false); return; }
        dir = picked;
      }
      await onLaunch(profile.name, dir);
    } catch (err: any) {
      setLaunchError(`Launch failed: ${err?.message ?? "Unknown error"}`);
    } finally {
      setLaunching(false);
    }
  };

  const handleLaunchWithOptions = async (options: LaunchOptions) => {
    if (!profile) return;
    setLaunchError(null);
    setLaunching(true);
    try {
      if (dirty) {
        try {
          await handleSave();
        } catch (err: any) {
          setLaunchError(`Save failed: ${err?.message ?? "Unknown error"}`);
          setLaunching(false);
          return;
        }
      }
      let dir = launchDir || undefined;
      if (!dir) {
        const picked = await window.api.selectDirectory();
        if (!picked) { setLaunching(false); return; }
        dir = picked;
      }
      await window.api.launchProfileWithOptions(profile.name, dir, options);
    } catch (err: any) {
      setLaunchError(`Launch failed: ${err?.message ?? "Unknown error"}`);
    } finally {
      setLaunching(false);
    }
  };

  // ─── Tab counts ────────────────────────────────────────────────────────────

  const tabCounts = useMemo<Partial<Record<TabId, string>>>(() => {
    const enabledPlugins = plugins.filter((p) => selectedPlugins.includes(p.name));
    const totalPlugins = plugins.filter((p) => p.items.length > 0 || p.mcpServers.length > 0).length;
    const allItems = plugins.flatMap((p) => p.items);
    const enabledItems = enabledPlugins.flatMap((p) =>
      p.items.filter((i) => !(excludedItems[p.name] ?? []).includes(i.name))
    );
    const pluginMcpCount = enabledPlugins.reduce((s, p) => s + p.mcpServers.length, 0);
    const standaloneMcpCount = mcpServers.length;

    const totalSkills = allItems.filter((i) => i.type === "skill").length;
    const totalAgents = allItems.filter((i) => i.type === "agent").length;
    const totalCommands = allItems.filter((i) => i.type === "command").length;
    const enabledSkills = enabledItems.filter((i) => i.type === "skill").length;
    const enabledAgents = enabledItems.filter((i) => i.type === "agent").length;
    const enabledCommands = enabledItems.filter((i) => i.type === "command").length;

    return {
      plugins: `${enabledPlugins.length}/${totalPlugins}`,
      skills: `${enabledSkills}/${totalSkills}`,
      agents: `${enabledAgents}/${totalAgents}`,
      commands: `${enabledCommands}/${totalCommands}`,
      mcp: `${pluginMcpCount + standaloneMcpCount}`,
      local: `${localItems.length}`,
    };
  }, [plugins, selectedPlugins, excludedItems, mcpServers, localItems]);

  // ─── Overview data ─────────────────────────────────────────────────────────

  const overview = useMemo(() => {
    const enabledPlugins = plugins.filter((p) => selectedPlugins.includes(p.name));
    const allItems = enabledPlugins.flatMap((p) =>
      p.items.filter((i) => !(excludedItems[p.name] ?? []).includes(i.name))
    );
    const skills = allItems.filter((i) => i.type === "skill");
    const agents = allItems.filter((i) => i.type === "agent");
    const commands = allItems.filter((i) => i.type === "command");
    const pluginMcps = enabledPlugins.flatMap((p) => p.mcpServers);
    const standaloneMcps = mcpServers.filter(
      (m) => !(disabledMcpServers[launchDir || directories[0] || ""] ?? []).includes(m.name)
    );
    const flags: string[] = [];
    if (launchFlags.dangerouslySkipPermissions) flags.push("--dangerously-skip-permissions");
    if (launchFlags.verbose) flags.push("--verbose");
    if (customFlags.trim()) flags.push(customFlags.trim());

    return { enabledPlugins, skills, agents, commands, pluginMcps, standaloneMcps, flags };
  }, [plugins, selectedPlugins, excludedItems, mcpServers, disabledMcpServers, launchDir, directories, launchFlags, customFlags]);

  // ─── Flat item list (skills / agents / commands tabs) ─────────────────────
  // Lifted out of the render IIFE so flatMap+filter+sort+groupCounts don't
  // rerun on unrelated re-renders (toggling a plugin, opening a modal, etc).
  const flatItemListData = useMemo(() => {
    if (activeTab !== "skills" && activeTab !== "agents" && activeTab !== "commands") {
      return null;
    }
    const type = activeTab === "skills" ? "skill" : activeTab === "agents" ? "agent" : "command";
    let items = plugins.flatMap((p) =>
      p.items
        .filter((i) => i.type === type)
        .map((i) => ({
          ...i,
          pluginName: p.name,
          pluginDisplayName: p.pluginName,
          enabled: selectedPlugins.includes(p.name) && !(excludedItems[p.name] ?? []).includes(i.name),
          pluginEnabled: selectedPlugins.includes(p.name),
        }))
    );

    if (itemSearch.trim()) {
      const q = itemSearch.toLowerCase().trim();
      items = items.filter((i) =>
        i.name.toLowerCase().includes(q) || i.pluginDisplayName.toLowerCase().includes(q)
      );
    }

    if (itemFilter === "enabled") items = items.filter((i) => i.enabled);
    if (itemFilter === "disabled") items = items.filter((i) => !i.enabled);

    items.sort((a, b) =>
      itemSort === "source"
        ? a.pluginDisplayName.localeCompare(b.pluginDisplayName) || a.name.localeCompare(b.name)
        : a.name.localeCompare(b.name)
    );

    let groupCounts: Map<string, { total: number; enabled: number }> | null = null;
    if (itemSort === "source") {
      groupCounts = new Map();
      for (const it of items) {
        const g = groupCounts.get(it.pluginDisplayName) ?? { total: 0, enabled: 0 };
        g.total++;
        if (it.enabled) g.enabled++;
        groupCounts.set(it.pluginDisplayName, g);
      }
    }

    return { type, items, groupCounts };
  }, [activeTab, plugins, selectedPlugins, excludedItems, itemSearch, itemFilter, itemSort]);

  // ─── Empty state ───────────────────────────────────────────────────────────

  if (!profile && !isNew) {
    return (
      <div className="profile-editor empty">
        <div className="empty-state">
          <div className="empty-state-icon">&#9671;</div>
          <div className="empty-state-title">No profile selected</div>
          <div className="empty-state-body">
            Choose a profile from the sidebar, or create a new one to get started.
          </div>
        </div>
      </div>
    );
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="profile-editor">
      {/* ── Fixed top bar ── */}
      <ProfileTopBar
        profile={profile}
        isNew={isNew}
        name={name}
        dirty={dirty}
        saving={saving}
        saveStatus={saveStatus}
        selectedPlugins={selectedPlugins}
        directories={[...new Set([...importedProjects, ...directories])]}
        launchDir={launchDir}
        launching={launching}
        importedProjectsCount={importedProjects.length}
        onOpenProjectsConfig={onOpenProjectsConfig}
        onChangeName={setName}
        markDirty={markDirty}
        onSetLaunchDir={setLaunchDir}
        onSetConfirmDelete={setConfirmDelete}
        onDuplicate={onDuplicate}
        onSetOverviewOpen={setOverviewOpen}
        onSave={handleSave}
        onLaunch={handleLaunch}
        onLaunchWithOptions={handleLaunchWithOptions}
      />

      {isDefault && (
        <div className="pe-default-banner">
          This is your default profile. Running <code>claude</code> in any terminal launches with these plugins and settings. Add only what you need for everyday use.
        </div>
      )}

      {launchError && (
        <div className="pe-launch-error">
          <span>{launchError}</span>
          <button className="pe-launch-error-dismiss" onClick={() => setLaunchError(null)}>
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      {brokenPlugins.length > 0 && (
        <div className="pe-health-warning">
          <div className="pe-health-warning-header">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 1.5L14.5 13H1.5L8 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none" />
              <path d="M8 6v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <circle cx="8" cy="11" r="0.7" fill="currentColor" />
            </svg>
            <span>
              {brokenPlugins.length} missing plugin{brokenPlugins.length !== 1 ? "s" : ""} — choose "Add plugin" to find it in the marketplace or "Remove" to drop it from this profile.
            </span>
          </div>
          <ul className="pe-health-warning-list">
            {brokenPlugins.map((pid) => {
              const shortName = pid.split("@")[0];
              const marketplaceId = pid.includes("@") ? pid.split("@")[1] : null;
              const busy = missingLookupBusy === pid;
              return (
                <li key={pid} className="pe-health-warning-row">
                  <div className="pe-health-plugin-id">
                    <span className="pe-health-plugin-name">{shortName}</span>
                    {marketplaceId && (
                      <span className="pe-health-plugin-marketplace">@{marketplaceId}</span>
                    )}
                  </div>
                  <div className="pe-health-actions">
                    <button
                      className="pe-health-add"
                      disabled={busy}
                      onClick={() => handleAddMissingPlugin(pid)}
                    >
                      {busy ? "Looking up…" : "Add plugin"}
                    </button>
                    <button
                      className="pe-health-remove"
                      onClick={() => removeOneMissingPlugin(pid)}
                    >
                      Remove
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* ── Scrollable content area ── */}
      <div className="pe-content">
        {/* Profile info card — collapsible */}
        <InfoCard
          description={description}
          isNew={isNew}
          onChangeDescription={(v) => { setDescription(v); markDirty(); }}
        />

        <TagsProjectsEditor
          tags={tags}
          projects={projects}
          tagSuggestions={tagSuggestions}
          importedProjects={importedProjects}
          onChangeTags={(v) => { setTags(v); markDirty(); }}
          onChangeProjects={(v) => { setProjects(v); markDirty(); }}
          onOpenProjectsConfig={() => onOpenProjectsConfig?.()}
          focusTagsSignal={focusTagsSignal}
          focusProjectsSignal={focusProjectsSignal}
        />

        {/* Tab strip */}
        <TabBar
          active={activeTab}
          counts={tabCounts}
          onChange={setActiveTab}
        />

        {/* Tab content */}
        <div
          className="pe-tab-content"
          role="tabpanel"
          id={`pe-tabpanel-${activeTab}`}
          aria-labelledby={`pe-tab-${activeTab}`}
          tabIndex={0}
        >
          {flatItemListData && (() => {
            const { type, items, groupCounts } = flatItemListData;
            return (
              <>
                <FilterBar
                  search={itemSearch}
                  onSearchChange={setItemSearch}
                  filter={itemFilter}
                  onFilterChange={setItemFilter}
                  sort={itemSort}
                  onSortChange={setItemSort}
                  placeholder={
                    activeTab === "skills"
                      ? "Search skills by name or plugin…"
                      : activeTab === "agents"
                        ? "Filter agents by name or plugin…"
                        : "Search commands by name or plugin…"
                  }
                />
                {items.length === 0 ? (
                  <div className="pe-tab-empty">
                    {itemSearch || itemFilter !== "all"
                      ? "No matches"
                      : `No ${activeTab} available. Install plugins to see ${activeTab} here.`}
                  </div>
                ) : (
                  <div className="pe-flat-list">
                    {items.map((item, idx) => {
                      const prev = items[idx - 1];
                      const showGroupHeader = groupCounts && (!prev || prev.pluginDisplayName !== item.pluginDisplayName);
                      const collapsed = !!groupCounts && collapsedGroups.has(item.pluginDisplayName);
                      const g = showGroupHeader ? groupCounts!.get(item.pluginDisplayName) : undefined;
                      return (
                        <React.Fragment key={`${item.pluginName}:${item.name}`}>
                          {showGroupHeader && g && (() => {
                            const groupItems = items.filter((it) => it.pluginDisplayName === item.pluginDisplayName);
                            const allEnabled = g.enabled === g.total;
                            return (
                              <div className={`pe-flat-group-header${collapsed ? " collapsed" : ""}`}>
                                <button
                                  type="button"
                                  className="pe-flat-group-collapse"
                                  onClick={() => toggleGroup(item.pluginDisplayName)}
                                  aria-expanded={!collapsed}
                                  aria-label={`${collapsed ? "Expand" : "Collapse"} ${item.pluginDisplayName} group`}
                                >
                                  <svg className="pe-flat-group-chevron" width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                                    <path d="M4 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                  <span className="pe-flat-group-name" title={item.pluginDisplayName}>{formatPluginTitle(item.pluginDisplayName)}</span>
                                  <span className="pe-flat-group-count">{g.enabled}/{g.total}</span>
                                </button>
                                <button
                                  type="button"
                                  className="pe-flat-group-select-all"
                                  onClick={() => {
                                    const payload = groupItems.map((gi) => ({ pluginName: gi.pluginName, itemName: gi.name }));
                                    handleToggleGroup(payload, !allEnabled);
                                  }}
                                  title={allEnabled ? "Deselect all in group" : "Select all in group"}
                                  aria-label={allEnabled ? `Deselect all ${item.pluginDisplayName} ${type}s` : `Select all ${item.pluginDisplayName} ${type}s`}
                                >
                                  {allEnabled ? "None" : "All"}
                                </button>
                              </div>
                            );
                          })()}
                          {!collapsed && (
                          <div
                            className="pe-flat-item"
                            title={item.description || undefined}
                          >
                            <div
                              className={`item-checkbox${item.enabled ? " checked" : ""}`}
                              onClick={() => {
                                if (!item.pluginEnabled && !item.enabled) {
                                  handleEnablePluginWithOnly(item.pluginName, item.name);
                                } else {
                                  handleToggleItem(item.pluginName, item.name, !item.enabled);
                                }
                              }}
                              role="checkbox"
                              aria-checked={item.enabled}
                              aria-label={type === "command" ? `/${item.name}` : item.name}
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === " " || e.key === "Enter") {
                                  e.preventDefault();
                                  if (!item.pluginEnabled && !item.enabled) {
                                    handleEnablePluginWithOnly(item.pluginName, item.name);
                                  } else {
                                    handleToggleItem(item.pluginName, item.name, !item.enabled);
                                  }
                                }
                              }}
                            />
                            <span className={`pe-flat-item-name${type === "command" ? " command-name" : ""}${!item.enabled ? " muted" : ""}`}>
                              {type === "command" ? `/${item.name}` : item.name}
                            </span>
                            {!groupCounts && <span className="pe-flat-item-source" title={item.pluginDisplayName}>{formatPluginTitle(item.pluginDisplayName)}</span>}
                            {!item.userInvocable && <span className="skill-badge internal">internal</span>}
                          </div>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </div>
                )}
              </>
            );
          })()}

          {activeTab === "mcp" && (
            <McpTab
              plugins={plugins}
              selectedPlugins={selectedPlugins}
              mcpServers={mcpServers}
              onTogglePlugin={handleTogglePlugin}
              launchDir={launchDir || directories[0] || ""}
              disabledMcpServers={disabledMcpServers}
              onToggleMcp={handleToggleMcp}
            />
          )}

          {activeTab === "local" && (
            <div className="pe-local-tab">
              {editingItem ? (
                <div className="project-item-editor">
                  <div className="manage-section-header">
                    <span className="manage-section-label">{editingItem.type}: {editingItem.name}</span>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        className="open-in-editor-btn"
                        onClick={() => window.api.openInFinder(editingItem.absolutePath)}
                        title="Open in default editor"
                      >
                        Open in Editor ↗
                      </button>
                      {editingDirty && (
                        <button className="btn-primary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={handleSaveEditingItem}>Save</button>
                      )}
                      <button className="btn-secondary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={handleCloseEditor}>Close</button>
                    </div>
                  </div>
                  <textarea
                    className="manage-claudemd-editor"
                    value={editingContent}
                    onChange={(e) => { setEditingContent(e.target.value); setEditingDirty(true); }}
                    placeholder={`${editingItem.type} content...`}
                  />
                </div>
              ) : !launchDir ? (
                <div className="empty-state" style={{ padding: "32px 0" }}>
                  <div className="empty-state-icon">&#9671;</div>
                  <div className="empty-state-title">Select a project directory</div>
                  <div className="empty-state-body">
                    Choose a directory in the topbar to see project-specific skills, agents, and commands.
                  </div>
                </div>
              ) : localItems.length === 0 ? (
                <div className="pe-tab-empty">
                  <p>No items found in {launchDir}/.claude/</p>
                  <p style={{ fontSize: "0.846rem", color: "var(--text-muted)", marginTop: "8px" }}>
                    Add skills, agents, or commands to your project's <code>.claude/</code> directory and they'll appear here.
                  </p>
                  <button className="btn-outlined-accent" style={{ marginTop: "8px" }} onClick={() => window.api.openInFinder(launchDir + "/.claude")}>
                    Open .claude/ directory
                  </button>
                </div>
              ) : (
                <>
                  <div className="local-items-note">
                    Items from <strong>{launchDir.split("/").pop()}</strong>/.claude/ — these are loaded automatically when launching into this directory, independent of profile settings.
                  </div>
                  {localItems.length < 3 && (
                    <div className="pe-local-helper-card">
                      <div className="pe-local-helper-body">
                        <div className="pe-local-helper-title">Add more project items</div>
                        <div className="pe-local-helper-text">
                          Drop skills, agents, or commands into this project's <code>.claude/</code> directory and they'll appear here alongside profile-level items.
                        </div>
                      </div>
                      <button
                        className="btn-outlined-accent"
                        onClick={() => window.api.openInFinder(launchDir + "/.claude")}
                      >
                        Open .claude/
                      </button>
                    </div>
                  )}
                  {(["skill", "agent", "command"] as const).map((type) => {
                    const items = localItems.filter((i) => i.type === type);
                    if (items.length === 0) return null;
                    return (
                      <div key={type} className="pe-mcp-section">
                        <div className="pe-mcp-section-label">
                          {type === "skill" ? "Skills" : type === "agent" ? "Agents" : "Commands"} ({items.length})
                        </div>
                        {items.map((item) => (
                          <div
                            key={item.path}
                            className="local-item enabled clickable"
                            role="button"
                            tabIndex={0}
                            title={`Edit ${item.name}`}
                            onClick={() => handleOpenItemEditor(item)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                handleOpenItemEditor(item);
                              }
                            }}
                          >
                            <span className="local-item-name">{item.name}</span>
                            <span className="plugin-badge">{item.type}</span>
                            <span className="local-item-chevron" aria-hidden="true">›</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          )}

          {activeTab === "plugins" && (
            <PluginPicker
              plugins={plugins}
              selectedPlugins={selectedPlugins}
              excludedItems={excludedItems}
              directory={directories[0] ?? ""}
              onTogglePlugin={handleTogglePlugin}
              onToggleItem={handleToggleItem}
              onEnablePluginWithOnly={handleEnablePluginWithOnly}
              favouritePlugins={favouritePlugins}
              onToggleFavourite={handleToggleFavourite}
            />
          )}

          {activeTab === "instructions" && (
            <div className="pe-instructions-tab">
              {promptPickerTarget && (
                <PromptPicker
                  onSelect={(content) => {
                    const append = (prev: string) => prev ? prev + "\n\n" + content : content;
                    if (promptPickerTarget === "instructions") setCustomClaudeMd(append);
                    else setWorkflow(append);
                    markDirty();
                  }}
                  onClose={() => setPromptPickerTarget(null)}
                />
              )}

              {/* Always-on instructions — written to <config>/CLAUDE.md */}
              <section className="pe-instructions-section always-on">
                <div className="pe-editor-toolbar">
                  <div className="pe-instructions-labels">
                    <span className="pe-instructions-heading">
                      <span className="pe-instructions-state-pill always-on" aria-label="Always on">Always on</span>
                      CLAUDE.md
                    </span>
                    <span className="pe-instructions-hint">Appended to CLAUDE.md — Claude reads this every turn.</span>
                  </div>
                  <div className="pe-editor-toolbar-actions">
                    <button className="insert-prompt-btn" onClick={() => setPromptPickerTarget("instructions")}>
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2"/><path d="M6 5h4M6 8h4M6 11h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                      Insert Prompt
                    </button>
                    <button className="open-in-editor-btn" onClick={async () => {
                      const configDir = await window.api.getProfileConfigDir(name);
                      window.api.openInFinder(`${configDir}/CLAUDE.md`);
                    }} title="Open in default editor">Open in Editor ↗</button>
                    {customClaudeMd.trim() && (
                      <button className="insert-prompt-btn" onClick={async () => {
                        const id = `prompt-${Date.now()}`;
                        const now = Date.now();
                        const prompts = await window.api.getPrompts();
                        const newPrompt = { id, name: name || "Untitled", description: `Saved from profile "${name}"`, tags: [], content: customClaudeMd, createdAt: now, updatedAt: now };
                        await window.api.savePrompts([...prompts, newPrompt]);
                      }}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 3v10a1 1 0 001 1h8a1 1 0 001-1V6l-4-3H4a1 1 0 00-1 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M9 3v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                        Save as Prompt
                      </button>
                    )}
                  </div>
                </div>
                <textarea
                  className="pe-instructions-editor"
                  value={customClaudeMd}
                  onChange={(e) => { setCustomClaudeMd(e.target.value); markDirty(); }}
                  placeholder="Additional instructions for this profile..."
                />
                <div className="pe-instructions-stats">
                  {customClaudeMd.length.toLocaleString()} chars · {customClaudeMd ? customClaudeMd.split("\n").length : 0} lines
                </div>
              </section>

              {/* /workflow command — written to <config>/commands/workflow.md */}
              <section className="pe-instructions-section on-demand">
                <div className="pe-editor-toolbar">
                  <div className="pe-instructions-labels">
                    <span className="pe-instructions-heading">
                      <span className="pe-instructions-state-pill on-demand" aria-label="On demand">On demand</span>
                      <code className="pe-instructions-command">/workflow</code>
                    </span>
                    <span className="pe-instructions-hint">
                      Invoked on demand — runs when you type <code>/workflow</code> in a session.
                    </span>
                  </div>
                  <div className="pe-editor-toolbar-actions">
                    <button className="insert-prompt-btn" onClick={() => setPromptPickerTarget("workflow")}>
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2"/><path d="M6 5h4M6 8h4M6 11h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                      Insert Prompt
                    </button>
                    <button className="open-in-editor-btn" onClick={async () => {
                      const configDir = await window.api.getProfileConfigDir(name);
                      window.api.openInFinder(`${configDir}/commands/workflow.md`);
                    }} title="Open in default editor">Open in Editor ↗</button>
                    {workflow.trim() && (
                      <button className="insert-prompt-btn" onClick={async () => {
                        const id = `prompt-${Date.now()}`;
                        const now = Date.now();
                        const prompts = await window.api.getPrompts();
                        const newPrompt = { id, name: name ? `${name} workflow` : "Untitled workflow", description: `Workflow saved from profile "${name}"`, tags: ["workflow"], content: workflow, createdAt: now, updatedAt: now };
                        await window.api.savePrompts([...prompts, newPrompt]);
                      }}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 3v10a1 1 0 001 1h8a1 1 0 001-1V6l-4-3H4a1 1 0 00-1 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M9 3v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                        Save as Prompt
                      </button>
                    )}
                  </div>
                </div>
                <textarea
                  className="pe-instructions-editor"
                  value={workflow}
                  onChange={(e) => { setWorkflow(e.target.value); markDirty(); }}
                  placeholder="Describe how this profile should orchestrate its tools — e.g. “First run the code-explorer agent, then invoke systematic-debugging, then produce a bulleted report.”"
                />
                <div className="pe-instructions-stats">
                  {workflow.length.toLocaleString()} chars · {workflow ? workflow.split("\n").length : 0} lines
                </div>
              </section>
            </div>
          )}

          {activeTab === "settings" && (
            <SettingsTab
              model={model}
              opusContext={opusContext}
              sonnetContext={sonnetContext}
              effortLevel={effortLevel}
              voiceEnabled={voiceEnabled}
              alias={alias}
              isInPath={binInPath}
              launchFlags={launchFlags}
              customFlags={customFlags}
              useDefaultAuth={useDefaultAuth}
              isDefault={isDefault}
              onSetAsDefault={() => {
                setIsDefault(true);
                setAlias("claude");
                markDirty();
              }}
              onChangeModel={(v) => { setModel(v); markDirty(); }}
              onChangeOpusContext={(v) => { setOpusContext(v); markDirty(); }}
              onChangeSonnetContext={(v) => { setSonnetContext(v); markDirty(); }}
              onChangeEffort={(v) => { setEffortLevel(v); markDirty(); }}
              onChangeVoice={(v) => { setVoiceEnabled(v); markDirty(); }}
              onChangeAlias={(v) => { setAlias(v); markDirty(); }}
              onChangeLaunchFlags={(v) => { setLaunchFlags(v); markDirty(); }}
              onChangeCustomFlags={(v) => { setCustomFlags(v); markDirty(); }}
              onChangeUseDefaultAuth={(v) => { setUseDefaultAuth(v); markDirty(); }}
              env={env}
              profileName={name}
              disabledHooks={disabledHooks}
              statusLineConfig={statusLineConfig}
              onChangeEnv={(v) => { setEnv(v); markDirty(); }}
              onChangeDisabledHooks={(v) => { setDisabledHooks(v); markDirty(); }}
              onChangeStatusLineConfig={(v) => { setStatusLineConfig(v); markDirty(); }}
              onAddToPath={async () => { await window.api.addBinToPath(); setBinInPath(true); }}
            />
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && profile && (
        <ConfirmDialog
          title="Delete Profile"
          description={
            <>
              Are you sure you want to delete <strong>{profile.name}</strong>?
              {profile.isDefault && (
                <> This is your default profile. Deleting it means running <code>claude</code> will load all installed plugins.</>
              )}
              {" "}This will remove the profile configuration and its assembled config directory. This cannot be undone.
            </>
          }
          confirmLabel="Delete Profile"
          onConfirm={() => { setConfirmDelete(false); onDelete(profile.name); }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {/* Missing-plugin not-found confirmation — shown after the curated lookup
          fails to find the plugin in any marketplace we know about. */}
      {missingNotFoundPluginId && (
        <ConfirmDialog
          title="Plugin not found"
          description={
            <>
              <strong>{missingNotFoundPluginId.split("@")[0]}</strong> isn't available in any curated marketplace we can see
              {missingNotFoundPluginId.includes("@") && (
                <> (searched for <code>{missingNotFoundPluginId}</code>)</>
              )}
              . It may have been removed, renamed, or only lives in a private marketplace you haven't added. Remove it from this profile?
            </>
          }
          confirmLabel="Remove from profile"
          onConfirm={() => {
            const pid = missingNotFoundPluginId;
            setMissingNotFoundPluginId(null);
            removeOneMissingPlugin(pid);
          }}
          onCancel={() => setMissingNotFoundPluginId(null)}
        />
      )}

      {/* Overview modal */}
      {overviewOpen && (
        <OverviewModal
          overview={overview}
          excludedItems={excludedItems}
          model={model}
          effortLevel={effortLevel}
          customClaudeMd={customClaudeMd}
          onClose={() => setOverviewOpen(false)}
          onJumpToTab={(tab) => { setActiveTab(tab); setOverviewOpen(false); }}
        />
      )}


    </div>
  );
}
