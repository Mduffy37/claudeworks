import React, { useState, useMemo } from "react";
import type { PluginWithItems } from "../../../src/electron/types";
import { SkillToggler } from "./SkillToggler";

interface Props {
  plugins: PluginWithItems[];
  selectedPlugins: string[];
  excludedItems: Record<string, string[]>;
  directory: string;
  onTogglePlugin: (pluginName: string, enabled: boolean) => void;
  onToggleItem: (pluginName: string, itemName: string, enabled: boolean) => void;
}

export function PluginPicker({
  plugins,
  selectedPlugins,
  excludedItems,
  directory,
  onTogglePlugin,
  onToggleItem,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const globalPlugins = useMemo(
    () => plugins.filter((p) => p.scope === "user"),
    [plugins]
  );

  const localPlugins = useMemo(
    () =>
      plugins.filter(
        (p) => p.scope === "project" && p.projectPath === directory
      ),
    [plugins, directory]
  );

  const renderPlugin = (plugin: PluginWithItems) => {
    const enabled = selectedPlugins.includes(plugin.name);
    const isExpanded = expanded.has(plugin.name);
    const excludedCount = (excludedItems[plugin.name] ?? []).length;

    return (
      <div key={plugin.name} className={`plugin-row ${enabled ? "enabled" : "disabled"}`}>
        <div className="plugin-header" onClick={() => toggleExpand(plugin.name)}>
          <label className="plugin-checkbox" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onTogglePlugin(plugin.name, e.target.checked)}
            />
          </label>
          <span className="plugin-expand">{isExpanded ? "\u25BC" : "\u25B6"}</span>
          <span className="plugin-name">{plugin.pluginName}</span>
          <span className="plugin-badge scope">{plugin.scope}</span>
          <span className="plugin-badge version">v{plugin.version}</span>
          <span className="plugin-badge count">
            {plugin.items.length} item{plugin.items.length !== 1 ? "s" : ""}
          </span>
          {excludedCount > 0 && enabled && (
            <span className="plugin-badge excluded">
              {excludedCount} excluded
            </span>
          )}
        </div>
        {isExpanded && enabled && (
          <div className="plugin-items">
            <SkillToggler
              items={plugin.items}
              excludedNames={excludedItems[plugin.name] ?? []}
              onToggle={(itemName, itemEnabled) =>
                onToggleItem(plugin.name, itemName, itemEnabled)
              }
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="plugin-picker">
      <div className="plugin-section">
        <h3>Global Plugins</h3>
        {globalPlugins.length === 0 ? (
          <div className="empty-state">No global plugins installed</div>
        ) : (
          globalPlugins.map(renderPlugin)
        )}
      </div>

      <div className="plugin-section">
        <h3>Local Plugins</h3>
        {!directory ? (
          <div className="empty-state">Set a default directory above to see project plugins</div>
        ) : localPlugins.length === 0 ? (
          <div className="empty-state">No plugins installed for {directory}</div>
        ) : (
          localPlugins.map(renderPlugin)
        )}
      </div>
    </div>
  );
}
