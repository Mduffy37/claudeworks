import React, { useState, useMemo, useEffect, useRef } from "react";
import { useTranslation, Trans } from "react-i18next";
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
  onGoToTab,
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
  onGoToTab?: (tab: TabId) => void;
}) {
  const { t } = useTranslation(["profile", "common"]);
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
    setExpanded((prev) => prev === cat ? null : cat);
  };

  const stats: { key: OverviewCategory; label: string; count: number }[] = [
    { key: "plugins", label: t("profile:editor.plugins"), count: overview.enabledPlugins.length },
    { key: "skills", label: t("profile:editor.skills"), count: overview.skills.length },
    { key: "agents", label: t("profile:editor.agents"), count: overview.agents.length },
    { key: "commands", label: t("profile:editor.commands"), count: overview.commands.length },
    { key: "mcps", label: t("profile:editor.mcpServers"), count: overview.pluginMcps.length + overview.standaloneMcps.length },
  ];

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-dialog modal-dialog--overview" role="dialog" aria-modal="true" aria-label={t("profile:overview.title")} ref={dialogRef} tabIndex={-1}>
        <div className="modal-header">
          <span className="modal-title">{t("profile:overview.title")}</span>
          <button className="modal-close" onClick={onClose} aria-label={t("profile:overview.closeAriaLabel")}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-description">
            {t("profile:overview.description")}
          </p>
          <div className="overview-grid">
            {stats.map((s) => (
              <button
                key={s.key}
                className={`overview-stat${expanded === s.key ? " expanded" : ""}`}
                onClick={() => handleStatClick(s.key)}
              >
                <div className="overview-stat-value">{s.count}</div>
                <div className="overview-stat-label">{s.label}</div>
              </button>
            ))}
          </div>

          {expanded === "plugins" && overview.enabledPlugins.length > 0 && (
            <div className="overview-section">
              <div className="overview-section-label">{t("profile:overview.enabledPlugins")}</div>
              <div className="overview-list">
                {overview.enabledPlugins.map((p) => (
                  <div key={p.name} className="overview-list-item">
                    <span>{p.pluginName}</span>
                    <span className="overview-list-meta">
                      {t("profile:overview.itemsCount", { count: p.items.filter((i) => !(excludedItems[p.name] ?? []).includes(i.name)).length })}
                    </span>
                  </div>
                ))}
              </div>
              {onGoToTab && (
                <button
                  className="btn-secondary"
                  style={{ fontSize: "0.769rem", marginTop: "8px", padding: "3px 10px" }}
                  onClick={() => onGoToTab(categoryToTab["plugins"])}
                >
                  {t("profile:overview.goToTab", { tab: t("profile:editor.plugins") })}
                </button>
              )}
            </div>
          )}

          {expanded === "skills" && overview.skills.length > 0 && (
            <div className="overview-section">
              <div className="overview-section-label">{t("profile:overview.enabledSkills")}</div>
              <div className="overview-list">
                {overview.skills.map((i) => (
                  <div key={i.name} className="overview-list-item">
                    <span>{i.name}</span>
                    <span className="overview-list-meta">{i.plugin.split("@")[0]}</span>
                  </div>
                ))}
              </div>
              {onGoToTab && (
                <button
                  className="btn-secondary"
                  style={{ fontSize: "0.769rem", marginTop: "8px", padding: "3px 10px" }}
                  onClick={() => onGoToTab(categoryToTab["skills"])}
                >
                  {t("profile:overview.goToTab", { tab: t("profile:editor.skills") })}
                </button>
              )}
            </div>
          )}

          {expanded === "agents" && overview.agents.length > 0 && (
            <div className="overview-section">
              <div className="overview-section-label">{t("profile:overview.enabledAgents")}</div>
              <div className="overview-list">
                {overview.agents.map((i) => (
                  <div key={i.name} className="overview-list-item">
                    <span>{i.name}</span>
                    <span className="overview-list-meta">{i.plugin.split("@")[0]}</span>
                  </div>
                ))}
              </div>
              {onGoToTab && (
                <button
                  className="btn-secondary"
                  style={{ fontSize: "0.769rem", marginTop: "8px", padding: "3px 10px" }}
                  onClick={() => onGoToTab(categoryToTab["agents"])}
                >
                  {t("profile:overview.goToTab", { tab: t("profile:editor.agents") })}
                </button>
              )}
            </div>
          )}

          {expanded === "commands" && overview.commands.length > 0 && (
            <div className="overview-section">
              <div className="overview-section-label">{t("profile:overview.enabledCommands")}</div>
              <div className="overview-list">
                {overview.commands.map((i) => (
                  <div key={i.name} className="overview-list-item">
                    <span>/{i.name}</span>
                    <span className="overview-list-meta">{i.plugin.split("@")[0]}</span>
                  </div>
                ))}
              </div>
              {onGoToTab && (
                <button
                  className="btn-secondary"
                  style={{ fontSize: "0.769rem", marginTop: "8px", padding: "3px 10px" }}
                  onClick={() => onGoToTab(categoryToTab["commands"])}
                >
                  {t("profile:overview.goToTab", { tab: t("profile:editor.commands") })}
                </button>
              )}
            </div>
          )}

          {expanded === "mcps" && (overview.pluginMcps.length + overview.standaloneMcps.length) > 0 && (
            <div className="overview-section">
              <div className="overview-section-label">{t("profile:overview.enabledMcpServers")}</div>
              <div className="overview-list">
                {[...overview.pluginMcps, ...overview.standaloneMcps].map((m) => (
                  <div key={m.name} className="overview-list-item">
                    <span>{m.name}</span>
                  </div>
                ))}
              </div>
              {onGoToTab && (
                <button
                  className="btn-secondary"
                  style={{ fontSize: "0.769rem", marginTop: "8px", padding: "3px 10px" }}
                  onClick={() => onGoToTab(categoryToTab["mcps"])}
                >
                  {t("profile:overview.goToTab", { tab: t("profile:editor.mcpServers") })}
                </button>
              )}
            </div>
          )}

          {model && (
            <div className="overview-section">
              <div className="overview-section-label">{t("profile:editor.settings")}</div>
              <div className="overview-list">
                {model && <div className="overview-list-item"><span>{t("profile:overview.modelLabel", { model })}</span></div>}
                {effortLevel && <div className="overview-list-item"><span>{t("profile:overview.effortLabel", { level: effortLevel })}</span></div>}
              </div>
            </div>
          )}

          {overview.flags.length > 0 && (
            <div className="overview-section">
              <div className="overview-section-label">{t("profile:editor.launchFlags")}</div>
              <div className="overview-list">
                {overview.flags.map((f) => (
                  <div key={f} className="overview-list-item"><code>{f}</code></div>
                ))}
              </div>
            </div>
          )}

          {customClaudeMd && (
            <div className="overview-section">
              <div className="overview-section-label">{t("profile:editor.instructions")}</div>
              <div className="overview-instructions-preview">{customClaudeMd}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tab bar ─────────────────────────────────────────────────────────────────

function TabBar({
  active,
  counts,
  onChange,
}: {
  active: TabId;
  counts: Partial<Record<TabId, string>>;
  onChange: (id: TabId) => void;
}) {
  const { t } = useTranslation(["profile", "common"]);
  const TABS: { id: TabId; label: string }[] = [
    { id: "plugins", label: t("profile:editor.plugins") },
    { id: "skills", label: t("profile:editor.skills") },
    { id: "agents", label: t("profile:editor.agents") },
    { id: "commands", label: t("profile:editor.commands") },
    { id: "mcp", label: t("profile:editor.mcpServers") },
    { id: "local", label: t("profile:tabs.projectItems") },
    { id: "instructions", label: t("profile:editor.instructions") },
    { id: "settings", label: t("profile:editor.settings") },
  ];
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
    <div className="pe-tab-bar" role="tablist" aria-label={t("profile:tabs.sections")} onKeyDown={onKeyDown}>
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
  const { t } = useTranslation(["profile", "common"]);
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
  const [promptPickerTarget, setPromptPickerTarget] = useState<null | "instructions" | "workflow" | `variant-${number}`>(null);
  const [itemSort, setItemSort] = useState<SortOption>("source");

  // ─── Inline item editor ─────────────────────────────────────────────────────
  const itemRelativePath = (type: string, name: string): string => {
    if (type === "skill") return `.claude/skills/${name}/SKILL.md`;
    if (type === "agent") return `.claude/agents/${name}.md`;
    return `.claude/commands/${name}.md`;
  };

  // Save-as-prompt dialog
  const [savePromptContent, setSavePromptContent] = useState<string | null>(null);
  const [savePromptName, setSavePromptName] = useState("");
  const [savePromptDesc, setSavePromptDesc] = useState("");
  const [savePromptTags, setSavePromptTags] = useState("");

  const openSavePromptDialog = (content: string, defaultName: string) => {
    setSavePromptContent(content);
    setSavePromptName(defaultName);
    setSavePromptDesc("");
    setSavePromptTags("");
  };

  const handleSavePrompt = async () => {
    if (!savePromptContent || !savePromptName.trim()) return;
    const id = `prompt-${Date.now()}`;
    const now = Date.now();
    const prompts = await window.api.getPrompts();
    const tags = savePromptTags.split(",").map(t => t.trim()).filter(Boolean);
    const newPrompt = { id, name: savePromptName.trim(), description: savePromptDesc.trim(), tags, content: savePromptContent, createdAt: now, updatedAt: now };
    await window.api.savePrompts([...prompts, newPrompt]);
    setSavePromptContent(null);
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

  const handleDeleteEditingItem = async () => {
    if (!editingItem) return;
    if (editingItem.type === "skill") {
      await window.api.deleteProjectFile(editingItem.directory, `.claude/skills/${editingItem.name}`);
    } else {
      await window.api.deleteProjectFile(editingItem.directory, editingItem.relativePath);
    }
    handleCloseEditor();
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
    aliases, setAliases, disableDefaultAlias, setDisableDefaultAlias,
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
    workflows, setWorkflows,
    launchPrompt, setLaunchPrompt,
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
    saveError, setSaveError,
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
          setLaunchError(`${t("common:errors.saveFailed")} ${err?.message ?? t("common:errors.unknownError")}`);
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
      setLaunchError(`${t("common:errors.launchFailed")} ${err?.message ?? t("common:errors.unknownError")}`);
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
          setLaunchError(`${t("common:errors.saveFailed")} ${err?.message ?? t("common:errors.unknownError")}`);
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
      setLaunchError(`${t("common:errors.launchFailed")} ${err?.message ?? t("common:errors.unknownError")}`);
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
          <div className="empty-state-title">{t("profile:emptyState.noProfileSelected")}</div>
          <div className="empty-state-body">
            {t("profile:emptyState.chooseProfile")}
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
        onExport={profile ? async (name) => {
          await window.api.exportProfile(name);
        } : undefined}
        onSetOverviewOpen={setOverviewOpen}
        onSave={handleSave}
        onLaunch={handleLaunch}
        onLaunchWithOptions={handleLaunchWithOptions}
      />

      {isDefault && (
        <div className="pe-default-banner">
          {t('profile:defaultBanner')}
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
              {t("profile:health.missingPlugins", { count: brokenPlugins.length })}
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
                      {busy ? t("profile:health.lookingUp") : t("profile:health.addPlugin")}
                    </button>
                    <button
                      className="pe-health-remove"
                      onClick={() => removeOneMissingPlugin(pid)}
                    >
                      {t("profile:health.remove")}
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
                      ? t("profile:filter.skillsPlaceholder")
                      : activeTab === "agents"
                        ? t("profile:filter.agentsPlaceholder")
                        : t("profile:filter.commandsPlaceholder")
                  }
                />
                {items.length === 0 ? (
                  <div className="pe-tab-empty">
                    {itemSearch || itemFilter !== "all"
                      ? t("common:emptyStates.noMatches")
                      : t("profile:noItems", { tab: activeTab })}
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
                                  aria-label={collapsed ? t("profile:group.expand", { name: item.pluginDisplayName }) : t("profile:group.collapse", { name: item.pluginDisplayName })}
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
                                  title={allEnabled ? t("profile:group.deselectTitle") : t("profile:group.selectTitle")}
                                  aria-label={allEnabled ? `${t("profile:group.deselectTitle")} — ${item.pluginDisplayName} ${type}s` : `${t("profile:group.selectTitle")} — ${item.pluginDisplayName} ${type}s`}
                                >
                                  {allEnabled ? t("profile:group.none") : t("profile:group.all")}
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
                            {!item.userInvocable && <span className="skill-badge internal">{t("profile:internal")}</span>}
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
                    <span className="manage-section-label">{t("profile:local.itemHeader", { type: editingItem.type, name: editingItem.name })}</span>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <button
                        className="open-in-editor-btn"
                        onClick={() => window.api.openInFinder(editingItem.absolutePath)}
                        title={t("common:buttons.openInEditor")}
                      >
                        {t("common:buttons.openInEditor")}
                      </button>
                      {editingDirty && (
                        <button className="btn-primary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={handleSaveEditingItem}>{t("common:buttons.save")}</button>
                      )}
                      <button className="btn-secondary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={handleDeleteEditingItem}>{t("common:buttons.delete")}</button>
                      <button className="btn-secondary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={handleCloseEditor}>{t("common:buttons.close")}</button>
                    </div>
                  </div>
                  <textarea
                    className="manage-claudemd-editor"
                    value={editingContent}
                    onChange={(e) => { setEditingContent(e.target.value); setEditingDirty(true); }}
                    placeholder={t("profile:local.contentPlaceholder", { type: editingItem.type })}
                  />
                </div>
              ) : !launchDir ? (
                <div className="empty-state" style={{ padding: "32px 0" }}>
                  <div className="empty-state-icon">&#9671;</div>
                  <div className="empty-state-title">{t("profile:local.selectDir")}</div>
                  <div className="empty-state-body">
                    {t("profile:local.selectDirHint")}
                  </div>
                </div>
              ) : localItems.length === 0 ? (
                <div className="pe-tab-empty">
                  <p>{t("profile:local.noItemsInDir", { dir: launchDir })}</p>
                  <p style={{ fontSize: "0.846rem", color: "var(--text-muted)", marginTop: "8px" }}>
                    {t('profile:local.noItemsHint')}
                  </p>
                  <button className="btn-outlined-accent" style={{ marginTop: "8px" }} onClick={() => window.api.openInFinder(launchDir + "/.claude")}>
                    {t("profile:local.openClaudeDir")}
                  </button>
                </div>
              ) : (
                <>
                  <div className="local-items-note">
                    {t('profile:local.itemsFromDir')}
                  </div>
                  {localItems.length < 3 && (
                    <div className="pe-local-helper-card">
                      <div className="pe-local-helper-body">
                        <div className="pe-local-helper-title">{t("profile:local.addMoreItems")}</div>
                        <div className="pe-local-helper-text">
                          {t('profile:local.addMoreItemsHint')}
                        </div>
                      </div>
                      <button
                        className="btn-outlined-accent"
                        onClick={() => window.api.openInFinder(launchDir + "/.claude")}
                      >
                        {t("profile:local.openClaude")}
                      </button>
                    </div>
                  )}
                  {(["skill", "agent", "command"] as const).map((type) => {
                    const items = localItems.filter((i) => i.type === type);
                    if (items.length === 0) return null;
                    return (
                      <div key={type} className="pe-mcp-section">
                        <div className="pe-mcp-section-label">
                          {type === "skill" ? t("profile:editor.skills") : type === "agent" ? t("profile:editor.agents") : t("profile:editor.commands")} ({items.length})
                        </div>
                        {items.map((item) => (
                          <div
                            key={item.path}
                            className="local-item enabled clickable"
                            role="button"
                            tabIndex={0}
                            title={t("profile:local.editTitle", { name: item.name })}
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
                    else if (promptPickerTarget?.startsWith("variant-")) {
                      const vidx = parseInt(promptPickerTarget.split("-")[1], 10);
                      if (!isNaN(vidx) && vidx < workflows.length) {
                        const next = [...workflows];
                        next[vidx] = { ...next[vidx], body: next[vidx].body ? next[vidx].body + "\n\n" + content : content };
                        setWorkflows(next);
                      }
                    } else setWorkflow(append);
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
                      <span className="pe-instructions-state-pill always-on" aria-label={t("profile:instructions.alwaysOn")}>{t("profile:instructions.alwaysOn")}</span>
                      CLAUDE.md
                    </span>
                    <span className="pe-instructions-hint">{t("profile:instructions.claudeMdHint")}</span>
                  </div>
                  <div className="pe-editor-toolbar-actions">
                    <button className="insert-prompt-btn" onClick={() => setPromptPickerTarget("instructions")}>
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2"/><path d="M6 5h4M6 8h4M6 11h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                      {t("common:buttons.insertPrompt")}
                    </button>
                    <button className="open-in-editor-btn" onClick={async () => {
                      const configDir = await window.api.getProfileConfigDir(name);
                      const filePath = `${configDir}/CLAUDE.md`;
                      await window.api.writeProjectFile(configDir, "CLAUDE.md", customClaudeMd || "");
                      window.api.openInFinder(filePath);
                    }} title={t("common:buttons.openInEditor")}>{t("common:buttons.openInEditor")}</button>
                    {customClaudeMd.trim() && (
                      <button className="insert-prompt-btn" onClick={() => openSavePromptDialog(customClaudeMd, name || "Untitled")}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 3v10a1 1 0 001 1h8a1 1 0 001-1V6l-4-3H4a1 1 0 00-1 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M9 3v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                        {t("common:buttons.saveAsPrompt")}
                      </button>
                    )}
                  </div>
                </div>
                <textarea
                  className="pe-instructions-editor"
                  value={customClaudeMd}
                  onChange={(e) => { setCustomClaudeMd(e.target.value); markDirty(); }}
                  placeholder={t("profile:instructions.placeholder")}
                />
                <div className="pe-instructions-stats">
                  {t("common:labels.charsLines", { chars: customClaudeMd.length.toLocaleString(), lines: customClaudeMd ? customClaudeMd.split("\n").length : 0 })}
                </div>
              </section>

              {/* /workflow command — written to <config>/commands/workflow.md */}
              <section className="pe-instructions-section on-demand">
                <div className="pe-editor-toolbar">
                  <div className="pe-instructions-labels">
                    <span className="pe-instructions-heading">
                      <span className="pe-instructions-state-pill on-demand" aria-label={t("profile:instructions.onDemand")}>{t("profile:instructions.onDemand")}</span>
                      <code className="pe-instructions-command">/workflow</code>
                    </span>
                    <span className="pe-instructions-hint">
                      {t('profile:instructions.workflowHint')}
                    </span>
                  </div>
                  <div className="pe-editor-toolbar-actions">
                    <button className="insert-prompt-btn" onClick={() => setPromptPickerTarget("workflow")}>
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2"/><path d="M6 5h4M6 8h4M6 11h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                      {t("common:buttons.insertPrompt")}
                    </button>
                    <button className="open-in-editor-btn" onClick={async () => {
                      const configDir = await window.api.getProfileConfigDir(name);
                      const filePath = `${configDir}/commands/workflow.md`;
                      const frontmatter = `---\ndescription: Run this profile's predefined workflow\n---\n\n`;
                      await window.api.writeProjectFile(configDir, "commands/workflow.md", workflow ? frontmatter + workflow : "");
                      window.api.openInFinder(filePath);
                    }} title={t("common:buttons.openInEditor")}>{t("common:buttons.openInEditor")}</button>
                    {workflow.trim() && (
                      <button className="insert-prompt-btn" onClick={() => openSavePromptDialog(workflow, name ? `${name} workflow` : "Untitled workflow")}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 3v10a1 1 0 001 1h8a1 1 0 001-1V6l-4-3H4a1 1 0 00-1 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M9 3v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                        {t("common:buttons.saveAsPrompt")}
                      </button>
                    )}
                  </div>
                </div>
                <textarea
                  className="pe-instructions-editor"
                  value={workflow}
                  onChange={(e) => { setWorkflow(e.target.value); markDirty(); }}
                  placeholder={t("profile:instructions.workflowPlaceholder")}
                />
                <div className="pe-instructions-stats">
                  {t("common:labels.charsLines", { chars: workflow.length.toLocaleString(), lines: workflow ? workflow.split("\n").length : 0 })}
                </div>
              </section>

              {/* Workflow variants — named /workflow-{name} commands */}
              <section className="pe-instructions-section variants">
                <div className="pe-editor-toolbar">
                  <div className="pe-instructions-labels">
                    <span className="pe-instructions-heading">
                      {t("profile:instructions.variants.title")}
                    </span>
                    <span className="pe-instructions-hint">
                      {t('profile:instructions.variants.hint')}
                    </span>
                  </div>
                </div>

                {workflows
                  .filter((variant) => {
                    // Hide project-exclusive variants that don't match the current launch directory
                    if (!variant.directory) return true;
                    if (!launchDir) return true; // show all when no dir selected
                    return variant.directory === launchDir;
                  })
                  .map((variant) => {
                    const idx = workflows.indexOf(variant);
                    return (
                  <div key={idx} className="workflow-variant-card">
                    <div className="workflow-variant-controls">
                      <span className="workflow-variant-prefix">workflow-</span>
                      <div className="field" style={{ flex: "0 0 auto", width: "15ch", margin: 0 }}>
                        <input
                          type="text"
                          value={variant.name}
                          onChange={(e) => {
                            const next = [...workflows];
                            next[idx] = { ...next[idx], name: e.target.value.replace(/[^a-z0-9-]/g, "") };
                            setWorkflows(next);
                            markDirty();
                          }}
                          placeholder={t("profile:instructions.variants.namePlaceholder")}
                        />
                      </div>
                      <div className="field-toggle">
                        <label className="toggle-switch" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={!!variant.directory}
                            onChange={(e) => {
                              const next = [...workflows];
                              next[idx] = { ...next[idx], directory: e.target.checked ? (launchDir || directories[0] || undefined) : undefined };
                              setWorkflows(next);
                              markDirty();
                            }}
                          />
                          <span className="toggle-track"><span className="toggle-thumb" /></span>
                        </label>
                        <span className="field-toggle-label">{variant.directory ? t("profile:instructions.variants.projectOnly", { project: variant.directory.split("/").pop() || "project" }) : t("profile:instructions.variants.thisProjectOnly")}</span>
                      </div>
                      <button className="insert-prompt-btn" style={{ marginLeft: "auto" }} onClick={() => setPromptPickerTarget(`variant-${idx}`)}>
                        <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2"/><path d="M6 5h4M6 8h4M6 11h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                        {t("common:buttons.insertPrompt")}
                      </button>
                      <button className="open-in-editor-btn" onClick={async () => {
                        if (!variant.name) return;
                        const configDir = await window.api.getProfileConfigDir(name);
                        const relPath = `commands/workflow-${variant.name}.md`;
                        const frontmatter = `---\ndescription: Run the ${variant.name} workflow\n---\n\n`;
                        await window.api.writeProjectFile(configDir, relPath, variant.body ? frontmatter + variant.body : "");
                        window.api.openInFinder(`${configDir}/${relPath}`);
                      }} title={t("common:buttons.openInEditor")}>{t("common:buttons.openInEditor")}</button>
                      {variant.body?.trim() && (
                        <button className="insert-prompt-btn" onClick={() => openSavePromptDialog(variant.body, variant.name ? `workflow-${variant.name}` : "Untitled variant")}>
                          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M3 3v10a1 1 0 001 1h8a1 1 0 001-1V6l-4-3H4a1 1 0 00-1 1z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/><path d="M9 3v3h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>
                          {t("common:buttons.saveAsPrompt")}
                        </button>
                      )}
                      <button
                        className="btn-danger-ghost"
                        style={{ fontSize: "0.769rem", padding: "2px 8px" }}
                        onClick={() => {
                          setWorkflows(workflows.filter((_, i) => i !== idx));
                          markDirty();
                        }}
                      >
                        {t("profile:instructions.variants.remove")}
                      </button>
                    </div>
                    {/* Editor */}
                    <textarea
                      className="pe-instructions-editor"
                      style={{ minHeight: "100px" }}
                      value={variant.body}
                      onChange={(e) => {
                        const next = [...workflows];
                        next[idx] = { ...next[idx], body: e.target.value };
                        setWorkflows(next);
                        markDirty();
                      }}
                      placeholder={t("profile:instructions.variants.variantPlaceholder", { name: variant.name || "variant" })}
                    />
                  </div>
                    );
                  })}

                <button
                  className="btn-secondary"
                  style={{ marginTop: "4px" }}
                  onClick={() => {
                    setWorkflows([...workflows, { name: "", body: "" }]);
                    markDirty();
                  }}
                >
                  {t("profile:instructions.variants.addVariant")}
                </button>
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
              aliases={aliases}
              onChangeAliases={(v) => { setAliases(v); markDirty(); }}
              disableDefaultAlias={disableDefaultAlias}
              onChangeDisableDefaultAlias={(v) => { setDisableDefaultAlias(v); markDirty(); }}
              profileName={name}
              pluginCount={plugins.length}
              directories={[...new Set([...importedProjects, ...directories])]}
              isInPath={binInPath}
              launchFlags={launchFlags}
              customFlags={customFlags}
              useDefaultAuth={useDefaultAuth}
              isDefault={isDefault}
              onSetAsDefault={() => {
                if (isDefault) {
                  // Remove-as-default: clear flag, drop auto-managed "claude" alias.
                  setIsDefault(false);
                  setAliases(prev => prev.filter(a => a.name !== "claude"));
                } else {
                  // Set-as-default: flag + add "claude" alias if not already present.
                  setIsDefault(true);
                  setAliases(prev => prev.some(a => a.name === "claude") ? prev : [{ name: "claude" }, ...prev]);
                }
                markDirty();
              }}
              onChangeModel={(v) => { setModel(v); markDirty(); }}
              onChangeOpusContext={(v) => { setOpusContext(v); markDirty(); }}
              onChangeSonnetContext={(v) => { setSonnetContext(v); markDirty(); }}
              onChangeEffort={(v) => { setEffortLevel(v); markDirty(); }}
              onChangeVoice={(v) => { setVoiceEnabled(v); markDirty(); }}
              onChangeLaunchFlags={(v) => { setLaunchFlags(v); markDirty(); }}
              onChangeCustomFlags={(v) => { setCustomFlags(v); markDirty(); }}
              onChangeUseDefaultAuth={(v) => { setUseDefaultAuth(v); markDirty(); }}
              env={env}
              disabledHooks={disabledHooks}
              statusLineConfig={statusLineConfig}
              launchPrompt={launchPrompt}
              onChangeLaunchPrompt={(v) => { setLaunchPrompt(v); markDirty(); }}
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
          title={t("profile:dialogs.deleteTitle")}
          description={
            <>
              {t('profile:dialogs.deleteConfirm')}
              {profile.isDefault && (
                <> t('profile:dialogs.deleteDefaultWarning')</>
              )}
              {" "}{t("profile:dialogs.deleteCannotUndo")}
            </>
          }
          confirmLabel={t("profile:dialogs.deleteTitle")}
          onConfirm={() => { setConfirmDelete(false); onDelete(profile.name); }}
          onCancel={() => setConfirmDelete(false)}
        />
      )}

      {/* Missing-plugin not-found confirmation — shown after the curated lookup
          fails to find the plugin in any marketplace we know about. */}
      {missingNotFoundPluginId && (
        <ConfirmDialog
          title={t("profile:dialogs.pluginNotFound")}
          description={
            <>
              {t('profile:dialogs.pluginNotFoundDesc')}
              {missingNotFoundPluginId.includes("@") && (
                <> t('profile:dialogs.pluginNotFoundSearched')</>
              )}
              . {t("profile:dialogs.pluginNotFoundRemove")}
            </>
          }
          confirmLabel={t("profile:dialogs.removeFromProfile")}
          onConfirm={() => {
            const pid = missingNotFoundPluginId;
            setMissingNotFoundPluginId(null);
            removeOneMissingPlugin(pid);
          }}
          onCancel={() => setMissingNotFoundPluginId(null)}
        />
      )}

      {/* Save error dialog (alias conflicts, etc.) */}
      {saveError && (
        <ConfirmDialog
          title={t("profile:dialogs.cannotSave")}
          description={saveError}
          confirmLabel="OK"
          confirmVariant="primary"
          onConfirm={() => setSaveError(null)}
          onCancel={() => setSaveError(null)}
        />
      )}

      {/* Save as Prompt dialog */}
      {savePromptContent !== null && (
        <div className="modal-backdrop" onClick={() => setSavePromptContent(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <div className="modal-header">
              <span className="modal-title">{t("profile:dialogs.savePromptTitle")}</span>
              <button className="modal-close" onClick={() => setSavePromptContent(null)} aria-label={t("common:buttons.close")}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <div className="field">
                <label>{t("common:fields.name")}</label>
                <input type="text" value={savePromptName} onChange={(e) => setSavePromptName(e.target.value)} placeholder={t("profile:dialogs.namePlaceholder")} autoFocus />
              </div>
              <div className="field">
                <label>{t("common:fields.description")}</label>
                <input type="text" value={savePromptDesc} onChange={(e) => setSavePromptDesc(e.target.value)} placeholder={t("profile:dialogs.descriptionPlaceholder")} />
              </div>
              <div className="field">
                <label>{t("common:fields.tags")}</label>
                <input type="text" value={savePromptTags} onChange={(e) => setSavePromptTags(e.target.value)} placeholder={t("profile:dialogs.tagsPlaceholder")} />
                <div className="field-hint">{t("common:labels.commaSeparated")}</div>
              </div>
              <div className="modal-confirm-actions">
                <button className="btn-secondary" onClick={() => setSavePromptContent(null)}>{t("common:buttons.cancel")}</button>
                <button className="btn-primary" onClick={handleSavePrompt} disabled={!savePromptName.trim()}>{t("common:buttons.save")}</button>
              </div>
            </div>
          </div>
        </div>
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
          onGoToTab={(tab) => { setActiveTab(tab); setOverviewOpen(false); }}
        />
      )}


    </div>
  );
}
