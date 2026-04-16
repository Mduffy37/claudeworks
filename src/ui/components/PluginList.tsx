import React, { useState, useMemo } from "react";
import type { PluginWithItems } from "../../electron/types";

interface Props {
  plugins: PluginWithItems[];
  selectedPlugin: string | null;
  availableUpdates: Record<string, string>;
  onSelect: (name: string) => void;
}

function pluginSummary(plugin: PluginWithItems): string {
  const parts: string[] = [];
  const skills = plugin.items.filter((i) => i.type === "skill").length;
  const agents = plugin.items.filter((i) => i.type === "agent").length;
  const commands = plugin.items.filter((i) => i.type === "command").length;
  const mcps = plugin.mcpServers.length;
  if (skills > 0) parts.push(`${skills} skill${skills !== 1 ? "s" : ""}`);
  if (agents > 0) parts.push(`${agents} agent${agents !== 1 ? "s" : ""}`);
  if (commands > 0) parts.push(`${commands} cmd${commands !== 1 ? "s" : ""}`);
  if (mcps > 0) parts.push(`${mcps} MCP`);
  if (parts.length === 0) parts.push("LSP");
  return parts.join(", ");
}

export function PluginList({ plugins, selectedPlugin, availableUpdates, onSelect }: Props) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return plugins;
    return plugins.filter((p) => p.pluginName.toLowerCase().includes(q));
  }, [plugins, search]);

  const globalPlugins = useMemo(
    () => filtered.filter((p) => p.scope === "user"),
    [filtered]
  );

  const projectPlugins = useMemo(
    () => filtered.filter((p) => p.scope === "project"),
    [filtered]
  );

  const renderPlugin = (plugin: PluginWithItems) => {
    const isSelected = plugin.name === selectedPlugin;
    const hasUpdate = plugin.name in availableUpdates;
    const projectName = plugin.scope === "project" && plugin.projectPath
      ? plugin.projectPath.split("/").pop()
      : null;

    return (
      <div
        key={plugin.name}
        className={`pl-item${isSelected ? " selected" : ""}`}
        onClick={() => onSelect(plugin.name)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onSelect(plugin.name);
          }
        }}
      >
        <div className="pl-item-name">
          {plugin.pluginName}
          {hasUpdate && <span className="pl-update-dot" title="Update available" />}
          {projectName && (
            <span className="pl-project-chip" title={plugin.projectPath}>{projectName}</span>
          )}
        </div>
        <div className="pl-item-meta">
          v{plugin.version} &middot; {pluginSummary(plugin)}
        </div>
      </div>
    );
  };

  return (
    <div className="plugin-list-sidebar">
      <div className="pl-search">
        <input
          type="text"
          placeholder="Search plugins..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-search-input"
        />
      </div>

      {globalPlugins.length > 0 && (
        <div className="pl-section">
          <div className="pl-section-header">Global</div>
          {globalPlugins.map(renderPlugin)}
        </div>
      )}

      {projectPlugins.length > 0 && (
        <div className="pl-section">
          <div className="pl-section-header">Project</div>
          {projectPlugins.map(renderPlugin)}
        </div>
      )}

      {filtered.length === 0 && (
        <div className="empty-state" style={{ padding: "20px 8px" }}>
          <div className="empty-state-title">
            {search ? "No matches" : "No plugins installed"}
          </div>
        </div>
      )}
    </div>
  );
}
