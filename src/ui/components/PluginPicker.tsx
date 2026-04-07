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
  onEnablePluginWithOnly: (pluginName: string, itemName: string) => void;
}

// Chevron icon — rotates when expanded
function ChevronIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path
        d="M3 3.5L5 5.5L7 3.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function PluginPicker({
  plugins,
  selectedPlugins,
  excludedItems,
  directory,
  onTogglePlugin,
  onToggleItem,
  onEnablePluginWithOnly,
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
    () => plugins.filter((p) => p.scope === "project" && p.projectPath === directory),
    [plugins, directory]
  );

  const renderPlugin = (plugin: PluginWithItems) => {
    const enabled = selectedPlugins.includes(plugin.name);
    const isExpanded = expanded.has(plugin.name);
    const excludedCount = (excludedItems[plugin.name] ?? []).length;

    const handleItemToggle = (itemName: string, itemEnabled: boolean) => {
      if (!enabled && itemEnabled) {
        onEnablePluginWithOnly(plugin.name, itemName);
      } else {
        onToggleItem(plugin.name, itemName, itemEnabled);
      }
    };

    return (
      <div key={plugin.name} className={`plugin-row${enabled ? " enabled" : ""}`}>
        <div className="plugin-header" onClick={() => toggleExpand(plugin.name)}>
          {/* Toggle switch — stop propagation so it doesn't also expand/collapse */}
          <label
            className="toggle-switch"
            onClick={(e) => e.stopPropagation()}
            title={enabled ? "Disable plugin" : "Enable plugin"}
          >
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onTogglePlugin(plugin.name, e.target.checked)}
            />
            <span className="toggle-track">
              <span className="toggle-thumb" />
            </span>
          </label>

          {/* Expand arrow */}
          <span className={`plugin-expand${isExpanded ? " is-expanded" : ""}`}>
            <ChevronIcon />
          </span>

          <span className="plugin-name">{plugin.pluginName}</span>

          <span className="plugin-badge version">v{plugin.version}</span>
          <span className="plugin-badge count">
            {plugin.items.length} item{plugin.items.length !== 1 ? "s" : ""}
          </span>
          {plugin.mcpServers.length > 0 && (
            <span className="plugin-badge mcp">
              {plugin.mcpServers.length} MCP
            </span>
          )}
          {excludedCount > 0 && enabled && (
            <span className="plugin-badge excluded">
              {excludedCount} excluded
            </span>
          )}
        </div>

        {isExpanded && (
          <div className="plugin-items">
            {plugin.items.length === 0 ? (
              <div className="empty-state-inline">No configurable items</div>
            ) : (
              <SkillToggler
                items={plugin.items}
                allPlugins={plugins}
                pluginEnabled={enabled}
                excludedNames={excludedItems[plugin.name] ?? []}
                onToggle={handleItemToggle}
              />
            )}
            {plugin.mcpServers.length > 0 && (
              <div className="mcp-servers">
                <div className="skill-group-label" style={{ color: "var(--color-command)" }}>
                  <span className="skill-group-label-dot" />
                  MCP Servers
                  <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                    &nbsp;{plugin.mcpServers.length}
                  </span>
                </div>
                {plugin.mcpServers.map((mcp) => (
                  <div key={mcp.name} className="mcp-server-item">
                    <span className="mcp-server-name">{mcp.name}</span>
                    <span className="plugin-badge">{mcp.type}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="plugin-picker">
      <div className="plugin-section">
        <div className="plugin-section-header">
          <h3>Global Plugins</h3>
          {globalPlugins.length > 0 && (
            <span className="plugin-section-count">{globalPlugins.length}</span>
          )}
        </div>
        {globalPlugins.length === 0 ? (
          <div className="empty-state-inline">No global plugins installed</div>
        ) : (
          globalPlugins.map(renderPlugin)
        )}
      </div>

      <div className="plugin-section">
        <div className="plugin-section-header">
          <h3>Local Plugins</h3>
          {localPlugins.length > 0 && (
            <span className="plugin-section-count">{localPlugins.length}</span>
          )}
        </div>
        {!directory ? (
          <div className="empty-state-inline">
            Set a default directory above to see project plugins
          </div>
        ) : localPlugins.length === 0 ? (
          <div className="empty-state-inline">
            No plugins installed for {directory}
          </div>
        ) : (
          localPlugins.map(renderPlugin)
        )}
      </div>
    </div>
  );
}
