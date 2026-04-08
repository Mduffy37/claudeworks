import React from "react";
import type { PluginWithItems, StandaloneMcp } from "../../../electron/types";

interface McpTabProps {
  plugins: PluginWithItems[];
  selectedPlugins: string[];
  mcpServers: StandaloneMcp[];
  onTogglePlugin: (pluginName: string, enabled: boolean) => void;
  launchDir: string;
  disabledMcpServers: Record<string, string[]>;
  onToggleMcp: (dir: string, mcpName: string, enabled: boolean) => void;
}

export function McpTab({ plugins, selectedPlugins, mcpServers, onTogglePlugin, launchDir, disabledMcpServers, onToggleMcp }: McpTabProps) {
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
      <div className="pe-mcp-context">
        Showing project MCPs for <strong>{launchDir ? (launchDir.split("/").pop() ?? launchDir) : "default directory"}</strong>
      </div>
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
          <div className="pe-mcp-section-label">Project ({launchDir ? (launchDir.split("/").pop() ?? launchDir) : "default"})</div>
          {projectMcps.map((mcp) => {
            const isEnabled = !launchDir || !(disabledMcpServers[launchDir] ?? []).includes(mcp.name);
            return (
              <div
                key={mcp.name}
                className={`local-item${isEnabled ? " enabled" : ""}`}
              >
                <label
                  className="toggle-switch"
                  onClick={(e) => e.stopPropagation()}
                  title={isEnabled ? "Disable MCP server" : "Enable MCP server"}
                >
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={(e) => onToggleMcp(launchDir, mcp.name, e.target.checked)}
                  />
                  <span className="toggle-track">
                    <span className="toggle-thumb" />
                  </span>
                </label>
                <span className="local-item-name">{mcp.name}</span>
                <span className="plugin-badge">{mcp.type}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
