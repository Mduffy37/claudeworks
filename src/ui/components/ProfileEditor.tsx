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

  const handleToggleItem = (pluginName: string, itemName: string, enabled: boolean) => {
    setExcludedItems((prev) => {
      const current = prev[pluginName] ?? [];
      const next = enabled
        ? current.filter((n) => n !== itemName)
        : [...current, itemName];
      return { ...prev, [pluginName]: next };
    });
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
