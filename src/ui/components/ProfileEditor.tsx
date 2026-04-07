import React, { useState, useEffect } from "react";
import type { Profile, PluginWithItems, LocalItem } from "../../../src/electron/types";
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
  const [dirty, setDirty] = useState(false);

  // Sync state when profile prop changes
  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setDescription(profile.description);
      setDirectory(profile.directory ?? "");
      setSelectedPlugins([...profile.plugins]);
      setExcludedItems({ ...profile.excludedItems });
      setDirty(false);
    } else if (isNew) {
      setName("");
      setDescription("");
      setDirectory("");
      setSelectedPlugins([]);
      setExcludedItems({});
      setLocalItems([]);
      setDirty(false);
    }
  }, [profile, isNew]);

  // Scan local items when directory or profile changes
  useEffect(() => {
    if (directory) {
      window.api.getLocalItems(directory).then(setLocalItems);
    } else {
      setLocalItems([]);
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
