import React from "react";
import type { PluginWithItems } from "../../../electron/types";
import { SkillToggler } from "../SkillToggler";

interface ItemsTabProps {
  type: "skill" | "agent" | "command";
  plugins: PluginWithItems[];
  selectedPlugins: string[];
  excludedItems: Record<string, string[]>;
  onTogglePlugin: (pluginName: string, enabled: boolean) => void;
  onToggleItem: (pluginName: string, itemName: string, enabled: boolean) => void;
  onEnablePluginWithOnly: (pluginName: string, itemName: string) => void;
}

export function ItemsTab({
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
