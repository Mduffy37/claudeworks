import React, { useState, useEffect } from "react";
import type { Profile, PluginWithItems, LocalItem, StandaloneMcp } from "../../../src/electron/types";
import { PluginPicker } from "./PluginPicker";
import { LaunchBar } from "./LaunchBar";

interface Props {
  profile: Profile | null;
  plugins: PluginWithItems[];
  isNew: boolean;
  onSave: (profile: Profile) => void;
  onLaunch: (name: string, directory?: string) => void;
}

export function ProfileEditor({ profile, plugins, isNew, onSave, onLaunch }: Props) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [directory, setDirectory] = useState("");
  const [selectedPlugins, setSelectedPlugins] = useState<string[]>([]);
  const [excludedItems, setExcludedItems] = useState<Record<string, string[]>>({});
  const [localItems, setLocalItems] = useState<LocalItem[]>([]);
  const [mcpServers, setMcpServers] = useState<StandaloneMcp[]>([]);
  const [model, setModel] = useState<string>("");
  const [effortLevel, setEffortLevel] = useState<string>("");
  const [voiceEnabled, setVoiceEnabled] = useState<boolean | undefined>(undefined);
  const [customClaudeMd, setCustomClaudeMd] = useState("");
  const [dirty, setDirty] = useState(false);

  // Sync state when profile prop changes
  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setDescription(profile.description);
      setDirectory(profile.directory ?? "");
      setSelectedPlugins([...profile.plugins]);
      setExcludedItems({ ...profile.excludedItems });
      setModel(profile.model ?? "");
      setEffortLevel(profile.effortLevel ?? "");
      setVoiceEnabled(profile.voiceEnabled);
      setCustomClaudeMd(profile.customClaudeMd ?? "");
      setDirty(false);
    } else if (isNew) {
      setName("");
      setDescription("");
      setDirectory("");
      setSelectedPlugins([]);
      setExcludedItems({});
      setLocalItems([]);
      setModel("");
      setEffortLevel("");
      setVoiceEnabled(undefined);
      setCustomClaudeMd("");
      setDirty(false);
    }
  }, [profile, isNew]);

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
        newExcludedItems[depPlugin.name] = excluded.filter(
          (n) => n !== depItem.name
        );
      }

      if (depItem.dependencies.length > 0) {
        enableDependencies(depItem, newSelectedPlugins, newExcludedItems, visited);
      }
    }
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

  const handleSave = () => {
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      description,
      directory: directory || undefined,
      plugins: selectedPlugins,
      excludedItems,
      model: (model || undefined) as Profile["model"],
      effortLevel: (effortLevel || undefined) as Profile["effortLevel"],
      voiceEnabled,
      customClaudeMd: customClaudeMd || undefined,
    });
    setDirty(false);
  };

  const handleBrowseDir = async () => {
    const dir = await window.api.selectDirectory();
    if (dir) {
      setDirectory(dir);
      markDirty();
    }
  };

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

  return (
    <div className="profile-editor">
      <div className="editor-header">
        <div className="editor-header-left">
          <h2>{isNew ? "New Profile" : profile?.name}</h2>
          <div className="editor-header-subtitle">{subtitle}</div>
        </div>
        <button
          className="btn-primary"
          disabled={!name.trim() || !dirty}
          onClick={handleSave}
        >
          {isNew ? "Create Profile" : "Save Changes"}
        </button>
      </div>

      <div className="editor-fields">
        <div className="field">
          <label>Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              markDirty();
            }}
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
            onChange={(e) => {
              setDescription(e.target.value);
              markDirty();
            }}
            placeholder="What this profile is for"
          />
        </div>

        <div className="field-divider" />

        <div className="field">
          <label>Default Directory</label>
          <div className="field-with-button">
            <input
              type="text"
              value={directory}
              onChange={(e) => {
                setDirectory(e.target.value);
                markDirty();
              }}
              placeholder="~/projects/my-app"
            />
            <button className="btn-secondary" onClick={handleBrowseDir}>
              Browse
            </button>
          </div>
        </div>
      </div>

      <div className="plugin-section">
        <div className="plugin-section-header">
          <h3>Session Settings</h3>
        </div>
        <div className="editor-fields">
          <div className="field">
            <label>Model</label>
            <select
              value={model}
              onChange={(e) => { setModel(e.target.value); markDirty(); }}
            >
              <option value="">Default (inherit global)</option>
              <option value="opus">Opus</option>
              <option value="sonnet">Sonnet</option>
              <option value="haiku">Haiku</option>
            </select>
          </div>
          <div className="field-divider" />
          <div className="field">
            <label>Effort Level</label>
            <select
              value={effortLevel}
              onChange={(e) => { setEffortLevel(e.target.value); markDirty(); }}
            >
              <option value="">Default (inherit global)</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="max">Max</option>
            </select>
          </div>
          <div className="field-divider" />
          <div className="field">
            <label>Voice</label>
            <div className="field-toggle">
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={voiceEnabled ?? true}
                  onChange={(e) => { setVoiceEnabled(e.target.checked); markDirty(); }}
                />
                <span className="toggle-track">
                  <span className="toggle-thumb" />
                </span>
              </label>
              <span className="field-toggle-label">
                {voiceEnabled === undefined ? "Default" : voiceEnabled ? "Enabled" : "Disabled"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="plugin-section">
        <div className="plugin-section-header">
          <h3>Profile CLAUDE.md</h3>
        </div>
        <div className="local-items-note">
          Appended to your global CLAUDE.md for sessions using this profile
        </div>
        <textarea
          className="claude-md-editor"
          value={customClaudeMd}
          onChange={(e) => { setCustomClaudeMd(e.target.value); markDirty(); }}
          placeholder="Additional instructions for this profile..."
          rows={4}
        />
      </div>

      <PluginPicker
        plugins={plugins}
        selectedPlugins={selectedPlugins}
        excludedItems={excludedItems}
        directory={directory}
        onTogglePlugin={handleTogglePlugin}
        onToggleItem={handleToggleItem}
        onEnablePluginWithOnly={handleEnablePluginWithOnly}
      />

      {localItems.length > 0 && (
        <div className="plugin-section">
          <div className="plugin-section-header">
            <h3>Local Items</h3>
            <span className="plugin-section-count">{localItems.length}</span>
          </div>
          <div className="local-items-note">
            From {directory}/.claude/ — always loaded in this directory, not managed by profile
          </div>
          {localItems.map((item) => (
            <div key={item.path} className="local-item enabled">
              <span className="local-item-name">{item.name}</span>
              <span className="plugin-badge">{item.type}</span>
            </div>
          ))}
        </div>
      )}

      {(() => {
        const mcpOnlyPlugins = plugins.filter(
          (p) => p.items.length === 0 && p.mcpServers.length > 0
        );
        const pluginMcps = mcpOnlyPlugins.flatMap((p) =>
          p.mcpServers.map((m) => ({
            ...m,
            enabled: selectedPlugins.includes(p.name),
            pluginFullName: p.name,
          }))
        );
        const userMcps = mcpServers.filter((m) => m.scope === "user");
        const projectMcps = mcpServers.filter((m) => m.scope === "project");
        const total = pluginMcps.length + userMcps.length + projectMcps.length;
        if (total === 0) return null;

        return (
          <div className="plugin-section">
            <div className="plugin-section-header">
              <h3>MCP Servers</h3>
              <span className="plugin-section-count">{total}</span>
            </div>

            {pluginMcps.length > 0 && (
              <div className="mcp-scope-group">
                <div className="mcp-scope-label">Plugin</div>
                {pluginMcps.map((mcp) => (
                  <div key={mcp.name} className={`local-item${mcp.enabled ? " enabled" : ""}`}>
                    <label className="toggle-switch" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={mcp.enabled}
                        onChange={(e) => handleTogglePlugin(mcp.pluginFullName, e.target.checked)}
                      />
                      <span className="toggle-track">
                        <span className="toggle-thumb" />
                      </span>
                    </label>
                    <span className="local-item-name">{mcp.name}</span>
                    <span className="plugin-badge">{mcp.type}</span>
                  </div>
                ))}
              </div>
            )}

            {userMcps.length > 0 && (
              <div className="mcp-scope-group">
                <div className="mcp-scope-label">User</div>
                {userMcps.map((mcp) => (
                  <div key={mcp.name} className="local-item enabled">
                    <span className="local-item-name">{mcp.name}</span>
                    <span className="plugin-badge">{mcp.type}</span>
                  </div>
                ))}
              </div>
            )}

            {projectMcps.length > 0 && (
              <div className="mcp-scope-group">
                <div className="mcp-scope-label">Project</div>
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
      })()}

      {!isNew && profile && (
        <LaunchBar
          profileName={profile.name}
          defaultDirectory={profile.directory}
          dirty={dirty}
          onLaunch={(dir) => {
            if (dirty) handleSave();
            onLaunch(profile.name, dir);
          }}
        />
      )}
    </div>
  );
}
