import React, { useState, useEffect, useMemo } from "react";
import type {
  Profile,
  PluginWithItems,
  LocalItem,
  StandaloneMcp,
} from "../../../src/electron/types";
import { PluginPicker } from "./PluginPicker";
import { SkillToggler } from "./SkillToggler";
import { SettingsModal } from "./SettingsModal";

// ─── Types ─────────────────────────────────────────────────────────────────

type TabId = "skills" | "agents" | "commands" | "mcp" | "local" | "plugins";

interface Props {
  profile: Profile | null;
  plugins: PluginWithItems[];
  isNew: boolean;
  onSave: (profile: Profile) => void;
  onLaunch: (name: string, directory?: string) => void;
  onDelete: (name: string) => void;
  onDuplicate?: (name: string) => void;
}

// ─── Icons ──────────────────────────────────────────────────────────────────

function LaunchIcon({ spinning }: { spinning: boolean }) {
  if (spinning) {
    return (
      <svg
        width="13"
        height="13"
        viewBox="0 0 14 14"
        fill="none"
        style={{ animation: "pe-spin 1s linear infinite" }}
      >
        <circle
          cx="7"
          cy="7"
          r="5.5"
          stroke="rgba(255,255,255,0.3)"
          strokeWidth="1.5"
        />
        <path
          d="M7 1.5A5.5 5.5 0 0 1 12.5 7"
          stroke="white"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <path
        d="M3 7h8M8 4l3 3-3 3"
        stroke="white"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
      <path
        d="M6.5 1.5h3L10 3.4a5 5 0 011.2.7l1.8-.7 1.5 2.6-1.3 1.3a5 5 0 010 1.4l1.3 1.3-1.5 2.6-1.8-.7a5 5 0 01-1.2.7l-.5 1.9h-3L6 12.6a5 5 0 01-1.2-.7l-1.8.7L1.5 10l1.3-1.3a5 5 0 010-1.4L1.5 6l1.5-2.6 1.8.7A5 5 0 016 3.4l.5-1.9z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
        fill="none"
      />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      style={{
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 180ms ease",
      }}
    >
      <path
        d="M2.5 4L5 6.5L7.5 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function shortPath(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  return parts.length <= 1 ? dir : `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

// ─── Tab bar ─────────────────────────────────────────────────────────────────

const TABS: { id: TabId; label: string }[] = [
  { id: "plugins", label: "Plugins" },
  { id: "skills", label: "Skills" },
  { id: "agents", label: "Agents" },
  { id: "commands", label: "Commands" },
  { id: "mcp", label: "MCP Servers" },
  { id: "local", label: "Local" },
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

// ─── Items-by-type tab content ────────────────────────────────────────────────
// Shows items of one type (skill/agent/command) across all plugins,
// grouped by source plugin.

interface ItemsTabProps {
  type: "skill" | "agent" | "command";
  plugins: PluginWithItems[];
  selectedPlugins: string[];
  excludedItems: Record<string, string[]>;
  onTogglePlugin: (pluginName: string, enabled: boolean) => void;
  onToggleItem: (pluginName: string, itemName: string, enabled: boolean) => void;
  onEnablePluginWithOnly: (pluginName: string, itemName: string) => void;
}

function ItemsTab({
  type,
  plugins,
  selectedPlugins,
  excludedItems,
  onTogglePlugin,
  onToggleItem,
  onEnablePluginWithOnly,
}: ItemsTabProps) {
  // Collect all plugins that have at least one item of this type
  const relevant = plugins.filter((p) =>
    p.items.some((i) => i.type === type)
  );

  if (relevant.length === 0) {
    return (
      <div className="pe-tab-empty">
        No {type === "skill" ? "skills" : type === "agent" ? "agents" : "commands"} found across installed plugins.
      </div>
    );
  }

  return (
    <div className="pe-items-tab">
      {relevant.map((plugin) => {
        const enabled = selectedPlugins.includes(plugin.name);
        const itemsOfType = plugin.items.filter((i) => i.type === type);

        const handleItemToggle = (itemName: string, itemEnabled: boolean) => {
          if (!enabled && itemEnabled) {
            onEnablePluginWithOnly(plugin.name, itemName);
          } else {
            onToggleItem(plugin.name, itemName, itemEnabled);
          }
        };

        return (
          <div key={plugin.name} className="pe-plugin-group">
            <div className={`pe-plugin-group-header${enabled ? " enabled" : ""}`}>
              <label className="toggle-switch" onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => onTogglePlugin(plugin.name, e.target.checked)}
                />
                <span className="toggle-track">
                  <span className="toggle-thumb" />
                </span>
              </label>
              <span className="pe-plugin-group-name">{plugin.pluginName}</span>
              <span className="pe-plugin-group-version">v{plugin.version}</span>
            </div>
            <div className="pe-plugin-group-items">
              <SkillToggler
                items={itemsOfType}
                allPlugins={plugins}
                pluginEnabled={enabled}
                excludedNames={excludedItems[plugin.name] ?? []}
                onToggle={handleItemToggle}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── MCP tab content ──────────────────────────────────────────────────────────

interface McpTabProps {
  plugins: PluginWithItems[];
  selectedPlugins: string[];
  mcpServers: StandaloneMcp[];
  onTogglePlugin: (pluginName: string, enabled: boolean) => void;
}

function McpTab({ plugins, selectedPlugins, mcpServers, onTogglePlugin }: McpTabProps) {
  const pluginMcps = plugins
    .filter((p) => p.mcpServers.length > 0)
    .flatMap((p) =>
      p.mcpServers.map((m) => ({
        ...m,
        pluginFullName: p.name,
        pluginDisplayName: p.pluginName,
        enabled: selectedPlugins.includes(p.name),
      }))
    );

  const userMcps = mcpServers.filter((m) => m.scope === "user");
  const projectMcps = mcpServers.filter((m) => m.scope === "project");
  const total = pluginMcps.length + userMcps.length + projectMcps.length;

  if (total === 0) {
    return (
      <div className="pe-tab-empty">
        No MCP servers found. Install a plugin that provides MCP servers, or configure
        servers in ~/.claude.json.
      </div>
    );
  }

  return (
    <div className="pe-mcp-tab">
      {pluginMcps.length > 0 && (
        <div className="pe-mcp-section">
          <div className="pe-mcp-section-label">From Plugins</div>
          {pluginMcps.map((mcp) => (
            <div
              key={`${mcp.pluginFullName}:${mcp.name}`}
              className={`local-item${mcp.enabled ? " enabled" : ""}`}
            >
              <label
                className="toggle-switch"
                onClick={(e) => e.stopPropagation()}
                title={mcp.enabled ? "Disable plugin" : "Enable plugin"}
              >
                <input
                  type="checkbox"
                  checked={mcp.enabled}
                  onChange={(e) => onTogglePlugin(mcp.pluginFullName, e.target.checked)}
                />
                <span className="toggle-track">
                  <span className="toggle-thumb" />
                </span>
              </label>
              <span className="local-item-name">{mcp.name}</span>
              <span className="pe-mcp-source">{mcp.pluginDisplayName}</span>
              <span className="plugin-badge">{mcp.type}</span>
            </div>
          ))}
        </div>
      )}

      {userMcps.length > 0 && (
        <div className="pe-mcp-section">
          <div className="pe-mcp-section-label">User (~/.claude.json)</div>
          {userMcps.map((mcp) => (
            <div key={mcp.name} className="local-item enabled">
              <span className="local-item-name">{mcp.name}</span>
              <span className="plugin-badge">{mcp.type}</span>
            </div>
          ))}
        </div>
      )}

      {projectMcps.length > 0 && (
        <div className="pe-mcp-section">
          <div className="pe-mcp-section-label">Project (.claude.json)</div>
          {projectMcps.map((mcp) => (
            <div key={mcp.name} className="local-item enabled">
              <span className="local-item-name">{mcp.name}</span>
              <span className="plugin-badge">{mcp.type}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Profile info card ────────────────────────────────────────────────────────

interface InfoCardProps {
  name: string;
  description: string;
  directories: string[];
  isNew: boolean;
  onChangeName: (v: string) => void;
  onChangeDescription: (v: string) => void;
  onChangeDirectories: (dirs: string[]) => void;
  onBrowse: () => void;
}

function InfoCard({
  name,
  description,
  directories,
  isNew,
  onChangeName,
  onChangeDescription,
  onChangeDirectories,
  onBrowse,
}: InfoCardProps) {
  const [open, setOpen] = useState(isNew);

  const addDirectory = async () => {
    const dir = await window.api.selectDirectory();
    if (dir && !directories.includes(dir)) {
      onChangeDirectories([...directories, dir]);
    }
  };

  return (
    <div className="pe-info-card">
      <button
        className="pe-info-card-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="pe-info-card-toggle-label">Profile Info</span>
        {!open && directories.length > 0 && (
          <span className="pe-info-card-toggle-dir">{directories[0]}{directories.length > 1 ? ` +${directories.length - 1}` : ""}</span>
        )}
        <span className="pe-info-card-toggle-chevron">
          <ChevronIcon open={open} />
        </span>
      </button>

      {open && (
        <div className="pe-info-card-body">
          <div className="field">
            <label>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => onChangeName(e.target.value)}
              placeholder="e.g. frontend, research, devops"
              disabled={!isNew}
            />
          </div>

          <div className="field-divider" />

          <div className="field">
            <label>Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => onChangeDescription(e.target.value)}
              placeholder="What this profile is for"
            />
          </div>

          <div className="field-divider" />

          <div className="field">
            <label>Directories</label>
            <div className="dir-list">
              {directories.map((dir, i) => (
                <div key={dir} className="dir-list-item">
                  <span className="dir-list-path">{dir}</span>
                  <button
                    className="dir-list-remove"
                    onClick={() => onChangeDirectories(directories.filter((_, j) => j !== i))}
                    title="Remove"
                  >
                    &times;
                  </button>
                </div>
              ))}
              <div className="field-with-button">
                <button className="btn-secondary" onClick={addDirectory} style={{ width: "100%" }}>
                  + Add Directory
                </button>
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

// ─── Main editor ──────────────────────────────────────────────────────────────

export function ProfileEditor({ profile, plugins, isNew, onSave, onLaunch, onDelete, onDuplicate }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [directory, setDirectory] = useState("");
  const [directories, setDirectories] = useState<string[]>([]);
  const [alias, setAlias] = useState("");
  const [selectedPlugins, setSelectedPlugins] = useState<string[]>([]);
  const [excludedItems, setExcludedItems] = useState<Record<string, string[]>>({});
  const [localItems, setLocalItems] = useState<LocalItem[]>([]);
  const [mcpServers, setMcpServers] = useState<StandaloneMcp[]>([]);
  const [model, setModel] = useState<string>("");
  const [effortLevel, setEffortLevel] = useState<string>("");
  const [voiceEnabled, setVoiceEnabled] = useState<boolean | undefined>(undefined);
  const [customClaudeMd, setCustomClaudeMd] = useState("");
  const [dirty, setDirty] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("plugins");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launchDir, setLaunchDir] = useState("");
  const [binInPath, setBinInPath] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Sync state when profile prop changes
  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setDescription(profile.description);
      const dirs = profile.directories ?? (profile.directory ? [profile.directory] : []);
      setDirectories(dirs);
      setDirectory(dirs[0] ?? "");
      setAlias(profile.alias ?? "");
      setSelectedPlugins([...profile.plugins]);
      setExcludedItems({ ...profile.excludedItems });
      setModel(profile.model ?? "");
      setEffortLevel(profile.effortLevel ?? "");
      setVoiceEnabled(profile.voiceEnabled);
      setCustomClaudeMd(profile.customClaudeMd ?? "");
      setLaunchDir(dirs[0] ?? "");
      setDirty(false);
    } else if (isNew) {
      setName("");
      setDescription("");
      setDirectory("");
      setDirectories([]);
      setAlias("");
      setSelectedPlugins([]);
      setExcludedItems({});
      setLocalItems([]);
      setModel("");
      setEffortLevel("");
      setVoiceEnabled(undefined);
      setCustomClaudeMd("");
      setLaunchDir("");
      setDirty(false);
    }
  }, [profile, isNew]);

  // Check if bin dir is in PATH
  useEffect(() => {
    window.api.isBinInPath().then(setBinInPath);
  }, []);

  // Scan local items and MCP servers when directory or profile changes
  useEffect(() => {
    if (directory) {
      window.api.getLocalItems(directory).then(setLocalItems);
      window.api.getMcpServers(directory).then(setMcpServers);
    } else {
      setLocalItems([]);
      window.api.getMcpServers().then(setMcpServers);
    }
  }, [directory, profile]);

  const markDirty = () => setDirty(true);

  // ─── Plugin/item toggle logic (unchanged) ──────────────────────────────────

  const resolveRef = (ref: string) => {
    const [refPlugin, refItem] = ref.split(":");
    const plugin = plugins.find(
      (p) => p.pluginName === refPlugin || p.name.startsWith(refPlugin + "@")
    );
    if (!plugin) return null;
    const item = plugin.items.find((i) => i.name === refItem);
    if (!item) return null;
    return { plugin, item };
  };

  const enableDependencies = (
    item: { dependencies: string[] },
    newSelectedPlugins: string[],
    newExcludedItems: Record<string, string[]>,
    visited: Set<string> = new Set()
  ) => {
    for (const dep of item.dependencies) {
      if (visited.has(dep)) continue;
      visited.add(dep);
      const resolved = resolveRef(dep);
      if (!resolved) continue;
      const { plugin: depPlugin, item: depItem } = resolved;
      if (!newSelectedPlugins.includes(depPlugin.name)) {
        newSelectedPlugins.push(depPlugin.name);
        newExcludedItems[depPlugin.name] = depPlugin.items
          .map((i) => i.name)
          .filter((n) => n !== depItem.name);
      } else {
        const excluded = newExcludedItems[depPlugin.name] ?? [];
        newExcludedItems[depPlugin.name] = excluded.filter((n) => n !== depItem.name);
      }
      if (depItem.dependencies.length > 0) {
        enableDependencies(depItem, newSelectedPlugins, newExcludedItems, visited);
      }
    }
  };

  const handleTogglePlugin = (pluginName: string, enabled: boolean) => {
    setSelectedPlugins((prev) =>
      enabled ? [...prev, pluginName] : prev.filter((n) => n !== pluginName)
    );
    if (!enabled) {
      setExcludedItems((prev) => {
        const next = { ...prev };
        delete next[pluginName];
        return next;
      });
    }
    markDirty();
  };

  const handleToggleItem = (pluginName: string, itemName: string, enabled: boolean) => {
    const newExcluded = { ...excludedItems };
    const newSelected = [...selectedPlugins];
    const current = newExcluded[pluginName] ?? [];

    if (enabled) {
      newExcluded[pluginName] = current.filter((n) => n !== itemName);
      const plugin = plugins.find((p) => p.name === pluginName);
      const item = plugin?.items.find((i) => i.name === itemName);
      if (item && item.dependencies.length > 0) {
        enableDependencies(item, newSelected, newExcluded);
        setSelectedPlugins(newSelected);
      }
    } else {
      newExcluded[pluginName] = [...current, itemName];
    }

    setExcludedItems(newExcluded);
    markDirty();
  };

  const handleEnablePluginWithOnly = (pluginName: string, itemName: string) => {
    const newSelected = [...selectedPlugins, pluginName];
    const newExcluded = { ...excludedItems };
    const plugin = plugins.find((p) => p.name === pluginName);
    if (plugin) {
      newExcluded[pluginName] = plugin.items
        .map((i) => i.name)
        .filter((n) => n !== itemName);
      const item = plugin.items.find((i) => i.name === itemName);
      if (item && item.dependencies.length > 0) {
        enableDependencies(item, newSelected, newExcluded);
      }
    }
    setSelectedPlugins(newSelected);
    setExcludedItems(newExcluded);
    markDirty();
  };

  // ─── Save / Launch ─────────────────────────────────────────────────────────

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      description,
      directory: directories[0] || undefined,
      directories: directories.length > 0 ? directories : undefined,
      alias: alias.trim() || undefined,
      plugins: selectedPlugins,
      excludedItems,
      model: (model || undefined) as Profile["model"],
      effortLevel: (effortLevel || undefined) as Profile["effortLevel"],
      voiceEnabled,
      customClaudeMd: customClaudeMd || undefined,
    });
    setDirty(false);
  };

  const handleLaunch = async () => {
    if (!profile) return;
    setLaunchError(null);
    setLaunching(true);
    try {
      if (dirty) handleSave();
      await onLaunch(profile.name, launchDir || undefined);
    } catch (err: any) {
      setLaunchError(err?.message ?? "Unknown error");
    } finally {
      setLaunching(false);
    }
  };

  const handleBrowseDir = async () => {
    const dir = await window.api.selectDirectory();
    if (dir) {
      setDirectory(dir);
      markDirty();
    }
  };

  // ─── Tab counts ────────────────────────────────────────────────────────────

  const tabCounts = useMemo<Partial<Record<TabId, number>>>(() => {
    const countType = (type: "skill" | "agent" | "command") =>
      plugins.reduce((sum, p) => sum + p.items.filter((i) => i.type === type).length, 0);

    const mcpOnlyPlugins = plugins.filter(
      (p) => p.items.length === 0 && p.mcpServers.length > 0
    );
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

  // ─── Settings badge ────────────────────────────────────────────────────────


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

  const enabledCount = selectedPlugins.length;
  const subtitle = isNew
    ? "Configure plugins and skills for this profile"
    : enabledCount === 0
    ? "No plugins enabled"
    : `${enabledCount} plugin${enabledCount !== 1 ? "s" : ""} enabled`;

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="profile-editor">
      {/* ── Fixed top bar ── */}
      <div className="pe-topbar">
        <div className="pe-topbar-identity">
          <h2 className="pe-topbar-name">{isNew ? "New Profile" : name}</h2>
          <span className="pe-topbar-subtitle">{subtitle}</span>
        </div>

        <div className="pe-topbar-actions">
          {/* Delete — only for existing profiles */}
          {!isNew && profile && (
            <button
              className="pe-delete-btn"
              onClick={() => setConfirmDelete(true)}
              title="Delete profile"
            >
              <svg width="13" height="13" viewBox="0 0 12 13" fill="none">
                <path d="M1 3h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M4.5 3V2a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                <path d="M2 3l.7 7.3A.8.8 0 0 0 2.7 11h6.6a.8.8 0 0 0 .8-.7L10.8 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4.5 5.5v3M7.5 5.5v3" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
              </svg>
            </button>
          )}

          {/* Duplicate — only for existing profiles */}
          {!isNew && profile && onDuplicate && (
            <button
              className="pe-duplicate-btn"
              onClick={() => onDuplicate(profile.name)}
              title="Duplicate profile"
            >
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
                <rect x="4" y="4" width="8" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.3" />
                <path d="M2 10V2.8A.8.8 0 0 1 2.8 2H10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              </svg>
            </button>
          )}

          {/* Settings gear */}
          <button
            className="pe-settings-btn"
            onClick={() => setSettingsOpen(true)}
            title="Session settings"
            aria-label="Open session settings"
          >
            <GearIcon />
            <span>Settings</span>
          </button>

          {/* Save */}
          <button
            className="btn-primary"
            disabled={!name.trim() || !dirty}
            onClick={handleSave}
          >
            {isNew ? "Create Profile" : "Save"}
          </button>

          {/* Launch — only for existing profiles */}
          {!isNew && profile && (
            <div className="pe-launch-group">
              {directories.length > 1 && (
                <select
                  className="pe-launch-dir-select"
                  value={launchDir}
                  onChange={(e) => setLaunchDir(e.target.value)}
                >
                  {directories.map((dir) => (
                    <option key={dir} value={dir}>{shortPath(dir)}</option>
                  ))}
                </select>
              )}
              <button
                className={`btn-launch${launching ? " launching" : ""}`}
                disabled={launching}
                onClick={handleLaunch}
                aria-label="Launch profile in iTerm2"
              >
                <span className="btn-launch-icon">
                  <LaunchIcon spinning={launching} />
                </span>
                {launching ? "Launching…" : "Launch"}
              </button>
            </div>
          )}
        </div>
      </div>

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
          onChangeDirectories={(dirs) => { setDirectories(dirs); setDirectory(dirs[0] ?? ""); markDirty(); }}
          onBrowse={handleBrowseDir}
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
            />
          )}

          {activeTab === "local" && (
            <div className="pe-local-tab">
              {!directory ? (
                <div className="pe-tab-empty">
                  Set a default directory to see local items.
                </div>
              ) : localItems.length === 0 ? (
                <div className="pe-tab-empty">
                  No local items found in {directory}/.claude/
                </div>
              ) : (
                <>
                  <div className="local-items-note">
                    From {directory}/.claude/ — always loaded in this directory, not managed by profile
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
              directory={directory}
              onTogglePlugin={handleTogglePlugin}
              onToggleItem={handleToggleItem}
              onEnablePluginWithOnly={handleEnablePluginWithOnly}
            />
          )}
        </div>
      </div>

      {/* Delete confirmation */}
      {confirmDelete && profile && (
        <div className="modal-backdrop" onClick={() => setConfirmDelete(false)}>
          <div className="modal-dialog modal-confirm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">Delete Profile</span>
              <button className="modal-close" onClick={() => setConfirmDelete(false)}>
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="modal-body">
              <p className="modal-description">
                Are you sure you want to delete <strong>{profile.name}</strong>? This will remove the profile configuration and its assembled config directory. This cannot be undone.
              </p>
              <div className="modal-confirm-actions">
                <button className="btn-secondary" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
                <button
                  className="btn-danger"
                  onClick={() => {
                    setConfirmDelete(false);
                    onDelete(profile.name);
                  }}
                >
                  Delete Profile
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Settings modal */}
      {settingsOpen && (
        <SettingsModal
          model={model}
          effortLevel={effortLevel}
          voiceEnabled={voiceEnabled}
          customClaudeMd={customClaudeMd}
          alias={alias}
          isInPath={binInPath}
          onChangeModel={(v) => { setModel(v); markDirty(); }}
          onChangeEffort={(v) => { setEffortLevel(v); markDirty(); }}
          onChangeVoice={(v) => { setVoiceEnabled(v); markDirty(); }}
          onChangeClaudeMd={(v) => { setCustomClaudeMd(v); markDirty(); }}
          onChangeAlias={(v) => { setAlias(v); markDirty(); }}
          onAddToPath={async () => { await window.api.addBinToPath(); setBinInPath(true); }}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      <style>{`
        @keyframes pe-spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
