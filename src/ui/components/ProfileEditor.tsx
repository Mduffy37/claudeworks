import React, { useMemo } from "react";
import type {
  Profile,
  PluginWithItems,
} from "../../../src/electron/types";
import { PluginPicker } from "./PluginPicker";
import { SettingsModal } from "./SettingsModal";
import { ConfirmDialog } from "./shared/ConfirmDialog";
import { useProfileDraft, type TabId } from "../hooks/useProfileDraft";
import { usePluginToggles } from "../hooks/usePluginToggles";
import { ProfileTopBar } from "./profile/ProfileTopBar";
import { InfoCard } from "./profile/InfoCard";
import { ItemsTab } from "./profile/ItemsTab";
import { McpTab } from "./profile/McpTab";

// ─── Types ─────────────────────────────────────────────────────────────────

interface Props {
  profile: Profile | null;
  plugins: PluginWithItems[];
  isNew: boolean;
  brokenPlugins: string[];
  onSave: (profile: Profile) => void;
  onLaunch: (name: string, directory?: string) => void;
  onDelete: (name: string) => void;
  onDuplicate?: (name: string) => void;
  dirty: boolean;
  onDirtyChange: (v: boolean) => void;
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

export function ProfileEditor({ profile, plugins, isNew, brokenPlugins, onSave, onLaunch, onDelete, onDuplicate, dirty, onDirtyChange }: Props) {
  const draft = useProfileDraft({ profile, isNew, onSave, dirty, onDirtyChange });

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
    settingsOpen, setSettingsOpen,
    overviewOpen, setOverviewOpen,
    launching, setLaunching,
    launchError, setLaunchError,
    launchDir, setLaunchDir,
    binInPath, setBinInPath,
    confirmDelete, setConfirmDelete,
    disabledMcpServers, setDisabledMcpServers,
    launchFlags, setLaunchFlags,
    customFlags, setCustomFlags,
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
      if (dirty) await handleSave();
      let dir = launchDir || undefined;
      if (!dir) {
        const picked = await window.api.selectDirectory();
        if (!picked) return;
        dir = picked;
      }
      await onLaunch(profile.name, dir);
    } catch (err: any) {
      setLaunchError(err?.message ?? "Unknown error");
    } finally {
      setLaunching(false);
    }
  };

  // ─── Tab counts ────────────────────────────────────────────────────────────

  const tabCounts = useMemo<Partial<Record<TabId, number>>>(() => {
    const countType = (type: "skill" | "agent" | "command") =>
      plugins.reduce((sum, p) => sum + p.items.filter((i) => i.type === type).length, 0);

    const pluginMcpCount = plugins.reduce((s, p) => s + p.mcpServers.length, 0);
    const standaloneMcpCount = mcpServers.length;

    return {
      skills: countType("skill"),
      agents: countType("agent"),
      commands: countType("command"),
      mcp: pluginMcpCount + standaloneMcpCount,
      local: localItems.length,
      plugins: plugins.filter((p) => p.items.length > 0 || p.mcpServers.length > 0).length,
    };
  }, [plugins, mcpServers, localItems]);

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
        selectedPlugins={selectedPlugins}
        directories={directories}
        launchDir={launchDir}
        launching={launching}
        onSetLaunchDir={setLaunchDir}
        onSetConfirmDelete={setConfirmDelete}
        onDuplicate={onDuplicate}
        onSetOverviewOpen={setOverviewOpen}
        onSetSettingsOpen={setSettingsOpen}
        onSave={handleSave}
        onLaunch={handleLaunch}
      />

      {launchError && (
        <div className="pe-launch-error">
          <span>Launch failed: {launchError}</span>
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
          </span>
        </div>
      )}

      {/* ── Scrollable content area ── */}
      <div className="pe-content">
        {/* Profile info card — collapsible */}
        <InfoCard
          name={name}
          description={description}
          directories={directories}
          isNew={isNew}
          onChangeName={(v) => { setName(v); markDirty(); }}
          onChangeDescription={(v) => { setDescription(v); markDirty(); }}
          onChangeDirectories={(dirs) => {
            setDirectories(dirs);
            setLaunchDir(dirs[0] ?? "");
            setDisabledMcpServers((prev) => {
              const pruned = Object.fromEntries(
                Object.entries(prev).filter(([k]) => dirs.includes(k))
              );
              return pruned;
            });
            markDirty();
          }}
        />

        {/* Tab strip */}
        <TabBar
          active={activeTab}
          counts={tabCounts}
          onChange={setActiveTab}
        />

        {/* Tab content */}
        <div className="pe-tab-content">
          {activeTab === "skills" && (
            <ItemsTab
              type="skill"
              plugins={plugins}
              selectedPlugins={selectedPlugins}
              excludedItems={excludedItems}
              onTogglePlugin={handleTogglePlugin}
              onToggleItem={handleToggleItem}
              onEnablePluginWithOnly={handleEnablePluginWithOnly}
            />
          )}

          {activeTab === "agents" && (
            <ItemsTab
              type="agent"
              plugins={plugins}
              selectedPlugins={selectedPlugins}
              excludedItems={excludedItems}
              onTogglePlugin={handleTogglePlugin}
              onToggleItem={handleToggleItem}
              onEnablePluginWithOnly={handleEnablePluginWithOnly}
            />
          )}

          {activeTab === "commands" && (
            <ItemsTab
              type="command"
              plugins={plugins}
              selectedPlugins={selectedPlugins}
              excludedItems={excludedItems}
              onTogglePlugin={handleTogglePlugin}
              onToggleItem={handleToggleItem}
              onEnablePluginWithOnly={handleEnablePluginWithOnly}
            />
          )}

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

      {/* Settings modal */}
      {settingsOpen && (
        <SettingsModal
          model={model}
          effortLevel={effortLevel}
          voiceEnabled={voiceEnabled}
          alias={alias}
          isInPath={binInPath}
          launchFlags={launchFlags}
          customFlags={customFlags}
          onChangeModel={(v) => { setModel(v); markDirty(); }}
          onChangeEffort={(v) => { setEffortLevel(v); markDirty(); }}
          onChangeVoice={(v) => { setVoiceEnabled(v); markDirty(); }}
          onChangeAlias={(v) => { setAlias(v); markDirty(); }}
          onChangeLaunchFlags={(v) => { setLaunchFlags(v); markDirty(); }}
          onChangeCustomFlags={(v) => { setCustomFlags(v); markDirty(); }}
          onAddToPath={async () => { await window.api.addBinToPath(); setBinInPath(true); }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {/* Overview modal */}
      {overviewOpen && (
        <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) setOverviewOpen(false); }}>
          <div className="modal-dialog" role="dialog" aria-modal="true" aria-label="Profile Overview">
            <div className="modal-header">
              <span className="modal-title">Profile Overview</span>
              <button className="modal-close" onClick={() => setOverviewOpen(false)} aria-label="Close overview">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-description">
                Summary of what this profile will load when launched.
              </p>
              <div className="overview-grid">
                <div className="overview-stat">
                  <div className="overview-stat-value">{overview.enabledPlugins.length}</div>
                  <div className="overview-stat-label">Plugins</div>
                </div>
                <div className="overview-stat">
                  <div className="overview-stat-value">{overview.skills.length}</div>
                  <div className="overview-stat-label">Skills</div>
                </div>
                <div className="overview-stat">
                  <div className="overview-stat-value">{overview.agents.length}</div>
                  <div className="overview-stat-label">Agents</div>
                </div>
                <div className="overview-stat">
                  <div className="overview-stat-value">{overview.commands.length}</div>
                  <div className="overview-stat-label">Commands</div>
                </div>
                <div className="overview-stat">
                  <div className="overview-stat-value">{overview.pluginMcps.length + overview.standaloneMcps.length}</div>
                  <div className="overview-stat-label">MCP Servers</div>
                </div>
              </div>

              {overview.enabledPlugins.length > 0 && (
                <div className="overview-section">
                  <div className="overview-section-label">Plugins</div>
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

              {(overview.pluginMcps.length + overview.standaloneMcps.length) > 0 && (
                <div className="overview-section">
                  <div className="overview-section-label">MCP Servers</div>
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
      )}

    </div>
  );
}
