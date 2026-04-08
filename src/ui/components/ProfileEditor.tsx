import React, { useState, useMemo, useEffect, useRef } from "react";
import type {
  Profile,
  PluginWithItems,
  PluginItem,
  StandaloneMcp,
} from "../../../src/electron/types";
import { PluginPicker } from "./PluginPicker";
import { ConfirmDialog } from "./shared/ConfirmDialog";
import { FilterBar, type FilterOption, type SortOption } from "./shared/FilterBar";
import { useProfileDraft, type TabId } from "../hooks/useProfileDraft";
import { usePluginToggles } from "../hooks/usePluginToggles";
import { ProfileTopBar } from "./profile/ProfileTopBar";
import { InfoCard } from "./profile/InfoCard";
import { McpTab } from "./profile/McpTab";
import { SettingsTab } from "./profile/SettingsTab";

// ─── Types ─────────────────────────────────────────────────────────────────

interface Props {
  profile: Profile | null;
  plugins: PluginWithItems[];
  isNew: boolean;
  brokenPlugins: string[];
  importedProjects?: string[];
  onSave: (profile: Profile) => void;
  onLaunch: (name: string, directory?: string) => void;
  onDelete: (name: string) => void;
  onDuplicate?: (name: string) => void;
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
}) {
  const [expanded, setExpanded] = useState<OverviewCategory>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const toggle = (cat: OverviewCategory) => setExpanded((prev) => prev === cat ? null : cat);

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
                onClick={() => toggle(s.key)}
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
  { id: "local", label: "Local" },
  { id: "instructions", label: "Instructions" },
  { id: "settings", label: "Settings" },
];

function TabBar({
  active,
  counts,
  onChange,
}: {
  active: TabId;
  counts: Partial<Record<TabId, number>>;
  onChange: (id: TabId) => void;
}) {
  return (
    <div className="pe-tab-bar">
      {TABS.map((tab) => {
        const count = counts[tab.id];
        return (
          <button
            key={tab.id}
            className={`pe-tab${active === tab.id ? " active" : ""}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
            {count !== undefined && count > 0 && (
              <span className="pe-tab-count">{count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ─── Main editor ──────────────────────────────────────────────────────────────

export function ProfileEditor({ profile, plugins, isNew, brokenPlugins, importedProjects = [], onSave, onLaunch, onDelete, onDuplicate, dirty, onDirtyChange, onRegisterSave }: Props) {
  const draft = useProfileDraft({ profile, isNew, onSave, dirty, onDirtyChange });

  // Register the editor's save function so the sidebar can trigger it
  useEffect(() => {
    onRegisterSave?.(draft.handleSave);
  }, [draft.handleSave, onRegisterSave]);

  const [itemSearch, setItemSearch] = useState("");
  const [itemFilter, setItemFilter] = useState<FilterOption>("all");
  const [itemSort, setItemSort] = useState<SortOption>("name");

  const {
    name, setName,
    description, setDescription,
    directories, setDirectories,
    alias, setAlias,
    selectedPlugins, setSelectedPlugins,
    excludedItems, setExcludedItems,
    localItems,
    mcpServers,
    model, setModel,
    effortLevel, setEffortLevel,
    voiceEnabled, setVoiceEnabled,
    customClaudeMd, setCustomClaudeMd,
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
    saving,
    saveStatus,
    handleSave,
    handleToggleMcp,
    markDirty,
  } = draft;

  const { handleTogglePlugin, handleToggleItem, handleEnablePluginWithOnly } =
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

  // ─── Tab counts ────────────────────────────────────────────────────────────

  const tabCounts = useMemo<Partial<Record<TabId, number>>>(() => {
    const enabledPlugins = plugins.filter((p) => selectedPlugins.includes(p.name));
    const allItems = plugins.flatMap((p) => p.items);
    const pluginMcpCount = enabledPlugins.reduce((s, p) => s + p.mcpServers.length, 0);
    const standaloneMcpCount = mcpServers.length;

    return {
      plugins: plugins.filter((p) => p.items.length > 0 || p.mcpServers.length > 0).length,
      skills: allItems.filter((i) => i.type === "skill").length,
      agents: allItems.filter((i) => i.type === "agent").length,
      commands: allItems.filter((i) => i.type === "command").length,
      mcp: pluginMcpCount + standaloneMcpCount,
      local: localItems.length,
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
        onChangeName={setName}
        markDirty={markDirty}
        onSetLaunchDir={setLaunchDir}
        onSetConfirmDelete={setConfirmDelete}
        onDuplicate={onDuplicate}
        onSetOverviewOpen={setOverviewOpen}
        onSave={handleSave}
        onLaunch={handleLaunch}
      />

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
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <path d="M8 1.5L14.5 13H1.5L8 1.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" fill="none" />
            <path d="M8 6v3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            <circle cx="8" cy="11" r="0.7" fill="currentColor" />
          </svg>
          <span>
            {brokenPlugins.length} missing plugin{brokenPlugins.length !== 1 ? "s" : ""}:{" "}
            {brokenPlugins.map((n) => n.split("@")[0]).join(", ")}
            {" "}
            <button className="pe-health-link" onClick={() => draft.setActiveTab("plugins")}>
              Go to Plugins &rarr;
            </button>
          </span>
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

        {/* Tab strip */}
        <TabBar
          active={activeTab}
          counts={tabCounts}
          onChange={setActiveTab}
        />

        {/* Tab content */}
        <div className="pe-tab-content">
          {(activeTab === "skills" || activeTab === "agents" || activeTab === "commands") && (() => {
            const type = activeTab === "skills" ? "skill" : activeTab === "agents" ? "agent" : "command";
            // Show ALL items of this type from ALL plugins
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

            // Apply search
            if (itemSearch.trim()) {
              const q = itemSearch.toLowerCase().trim();
              items = items.filter((i) =>
                i.name.toLowerCase().includes(q) || i.pluginDisplayName.toLowerCase().includes(q)
              );
            }

            // Apply filter
            if (itemFilter === "enabled") items = items.filter((i) => i.enabled);
            if (itemFilter === "disabled") items = items.filter((i) => !i.enabled);

            // Apply sort
            items.sort((a, b) =>
              itemSort === "source"
                ? a.pluginDisplayName.localeCompare(b.pluginDisplayName) || a.name.localeCompare(b.name)
                : a.name.localeCompare(b.name)
            );

            return (
              <>
                <FilterBar
                  search={itemSearch}
                  onSearchChange={setItemSearch}
                  filter={itemFilter}
                  onFilterChange={setItemFilter}
                  sort={itemSort}
                  onSortChange={setItemSort}
                  placeholder={`Search ${activeTab}...`}
                />
                {items.length === 0 ? (
                  <div className="pe-tab-empty">
                    {itemSearch || itemFilter !== "all"
                      ? "No matches"
                      : `No ${activeTab} available. Install plugins to see ${activeTab} here.`}
                  </div>
                ) : (
                  <div className="pe-flat-list">
                    {items.map((item) => (
                      <div key={`${item.pluginName}:${item.name}`} className="pe-flat-item">
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
                        <span className="pe-flat-item-source">{item.pluginDisplayName}</span>
                        {!item.userInvocable && <span className="skill-badge internal">internal</span>}
                      </div>
                    ))}
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
              {!launchDir ? (
                <div className="pe-tab-empty">
                  Select a directory to see local items.
                </div>
              ) : localItems.length === 0 ? (
                <div className="pe-tab-empty">
                  No local items found in {launchDir}/.claude/
                </div>
              ) : (
                <>
                  <div className="local-items-note">
                    From {launchDir}/.claude/ — always loaded in this directory, not managed by profile
                  </div>
                  {(["skill", "agent", "command"] as const).map((type) => {
                    const items = localItems.filter((i) => i.type === type);
                    if (items.length === 0) return null;
                    return (
                      <div key={type} className="pe-mcp-section">
                        <div className="pe-mcp-section-label">
                          {type === "skill" ? "Skills" : type === "agent" ? "Agents" : "Commands"} ({items.length})
                        </div>
                        {items.map((item) => (
                          <div key={item.path} className="local-item enabled">
                            <span className="local-item-name">{item.name}</span>
                            <span className="plugin-badge">{item.type}</span>
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
            />
          )}

          {activeTab === "instructions" && (
            <div className="pe-instructions-tab">
              <div className="pe-instructions-hint">
                Appended to your global CLAUDE.md for sessions using this profile
              </div>
              <textarea
                className="pe-instructions-editor"
                value={customClaudeMd}
                onChange={(e) => { setCustomClaudeMd(e.target.value); markDirty(); }}
                placeholder="Additional instructions for this profile..."
              />
            </div>
          )}

          {activeTab === "settings" && (
            <SettingsTab
              model={model}
              effortLevel={effortLevel}
              voiceEnabled={voiceEnabled}
              alias={alias}
              isInPath={binInPath}
              launchFlags={launchFlags}
              customFlags={customFlags}
              useDefaultAuth={useDefaultAuth}
              onChangeModel={(v) => { setModel(v); markDirty(); }}
              onChangeEffort={(v) => { setEffortLevel(v); markDirty(); }}
              onChangeVoice={(v) => { setVoiceEnabled(v); markDirty(); }}
              onChangeAlias={(v) => { setAlias(v); markDirty(); }}
              onChangeLaunchFlags={(v) => { setLaunchFlags(v); markDirty(); }}
              onChangeCustomFlags={(v) => { setCustomFlags(v); markDirty(); }}
              onChangeUseDefaultAuth={(v) => { setUseDefaultAuth(v); markDirty(); }}
              onAddToPath={async () => { await window.api.addBinToPath(); setBinInPath(true); }}
            />
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && profile && (
        <ConfirmDialog
          title="Delete Profile"
          description={<>Are you sure you want to delete <strong>{profile.name}</strong>? This will remove the profile configuration and its assembled config directory. This cannot be undone.</>}
          confirmLabel="Delete Profile"
          onConfirm={() => { setConfirmDelete(false); onDelete(profile.name); }}
          onCancel={() => setConfirmDelete(false)}
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
        />
      )}

    </div>
  );
}
