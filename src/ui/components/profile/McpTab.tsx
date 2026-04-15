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

function mcpTitle(mcp: { type: string; command?: string; url?: string }): string | undefined {
  const parts: string[] = [mcp.type];
  if (mcp.command) parts.push(mcp.command);
  else if (mcp.url) parts.push(mcp.url);
  return parts.join(" · ");
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
        {launchDir
        ? <>Showing project MCPs for <strong>{launchDir.split("/").pop() ?? launchDir}</strong></>
        : <>No directory selected — select one in the topbar to see project-specific MCP servers</>
      }
      </div>
      {pluginMcps.length > 0 && (
        <div className="pe-mcp-section pe-mcp-section-plugins">
          <div className="pe-mcp-section-head">
            <span className="pe-mcp-section-label">From Plugins</span>
            <span className="pe-mcp-section-hint">Toggling a row disables the source plugin for this profile.</span>
          </div>
          {pluginMcps.map((mcp) => (
            <div
              key={`${mcp.pluginFullName}:${mcp.name}`}
              className={`local-item${mcp.enabled ? " enabled" : ""}`}
              title={mcpTitle(mcp)}
            >
              <label
                className="toggle-switch"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={mcp.enabled}
                  onChange={(e) => onTogglePlugin(mcp.pluginFullName, e.target.checked)}
                  aria-label={`${mcp.enabled ? "Disable" : "Enable"} MCP server ${mcp.name} from plugin ${mcp.pluginDisplayName}`}
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
        <div className="pe-mcp-section pe-mcp-section-user">
          <div className="pe-mcp-section-head">
            <span className="pe-mcp-section-label">User <code>(~/.claude.json)</code></span>
            <span className="pe-mcp-section-hint">Always on for every session.</span>
          </div>
          {userMcps.map((mcp) => (
            <div key={mcp.name} className="local-item enabled" title={mcpTitle(mcp)}>
              <span className="local-item-name">{mcp.name}</span>
              <span className="plugin-badge">{mcp.type}</span>
            </div>
          ))}
        </div>
      )}

      {projectMcps.length > 0 && (
        <div className="pe-mcp-section pe-mcp-section-project">
          <div className="pe-mcp-section-head">
            <span className="pe-mcp-section-label">Project ({launchDir ? (launchDir.split("/").pop() ?? launchDir) : "default"})</span>
            <span className="pe-mcp-section-hint">Toggles persist per directory.</span>
          </div>
          {projectMcps.map((mcp) => {
            const isEnabled = !launchDir || !(disabledMcpServers[launchDir] ?? []).includes(mcp.name);
            return (
              <div
                key={mcp.name}
                className={`local-item${isEnabled ? " enabled" : ""}`}
                title={mcpTitle(mcp)}
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
