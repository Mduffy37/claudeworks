import React, { useState, useEffect } from "react";
import type { Profile, PluginWithItems } from "../../../src/electron/types";
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
      setDirty(false);
    }
  }, [profile, isNew]);

  const markDirty = () => setDirty(true);

  const handleTogglePlugin = (pluginName: string, enabled: boolean) => {
    setSelectedPlugins((prev) =>
      enabled ? [...prev, pluginName] : prev.filter((n) => n !== pluginName)
    );
    if (!enabled) {
      // Clear exclusions when plugin is removed
      setExcludedItems((prev) => {
        const next = { ...prev };
        delete next[pluginName];
        return next;
      });
    }
    markDirty();
  };

  // Resolve dependencies: given a "plugin:item" ref, find the plugin and item
  const resolveRef = (ref: string) => {
    const [refPlugin, refItem] = ref.split(":");
    // Find the plugin whose pluginName matches the ref prefix
    const plugin = plugins.find(
      (p) => p.pluginName === refPlugin || p.name.startsWith(refPlugin + "@")
    );
    if (!plugin) return null;
    const item = plugin.items.find((i) => i.name === refItem);
    if (!item) return null;
    return { plugin, item };
  };

  // Auto-enable dependencies for a given item (with cycle detection)
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

      // Enable the plugin if not already
      if (!newSelectedPlugins.includes(depPlugin.name)) {
        newSelectedPlugins.push(depPlugin.name);
        // Exclude all items by default — only enable what's needed
        newExcludedItems[depPlugin.name] = depPlugin.items
          .map((i) => i.name)
          .filter((n) => n !== depItem.name);
      } else {
        // Plugin already enabled — just un-exclude the dependency item
        const excluded = newExcludedItems[depPlugin.name] ?? [];
        newExcludedItems[depPlugin.name] = excluded.filter(
          (n) => n !== depItem.name
        );
      }

      // Recursively enable this item's dependencies
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

      // Auto-enable dependencies
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

    // Exclude all items except the one that was clicked
    const plugin = plugins.find((p) => p.name === pluginName);
    if (plugin) {
      newExcluded[pluginName] = plugin.items
        .map((i) => i.name)
        .filter((n) => n !== itemName);

      // Auto-enable dependencies for the clicked item
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
        <div className="empty-state">Select a profile or create a new one</div>
      </div>
    );
  }

  return (
    <div className="profile-editor">
      <div className="editor-header">
        <h2>{isNew ? "New Profile" : `Edit: ${profile?.name}`}</h2>
        <button className="btn-primary" disabled={!name.trim() || !dirty} onClick={handleSave}>
          {isNew ? "Create" : "Save"}
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

      {!isNew && profile && (
        <LaunchBar
          profileName={profile.name}
          defaultDirectory={profile.directory}
          onLaunch={(dir) => onLaunch(profile.name, dir)}
        />
      )}
    </div>
  );
}
