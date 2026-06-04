import React from "react";
import { useTranslation, Trans } from "react-i18next";
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
  const { t } = useTranslation(["plugin", "common"]);
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
        {t("plugin:mcp.noServers")}
      </div>
    );
  }

  return (
    <div className="pe-mcp-tab">
      <div className="pe-mcp-context">
        {launchDir
        ? t('plugin:mcp.showingProjectMcps')
        : t("plugin:mcp.noDirSelected")
      }
      </div>
      {pluginMcps.length > 0 && (
        <div className="pe-mcp-section pe-mcp-section-plugins">
          <div className="pe-mcp-section-head">
            <h3 className="pe-mcp-section-label">{t("plugin:mcp.fromPlugins", { count: pluginMcps.length })}</h3>
            <span className="pe-mcp-section-hint">{t("plugin:mcp.fromPluginsHint")}</span>
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
                  aria-label={`${mcp.enabled ? t("plugin:mcp.disableMcp") : t("plugin:mcp.enableMcp")} — ${mcp.name} (${mcp.pluginDisplayName})`}
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
            <h3 className="pe-mcp-section-label">t('plugin:mcp.userLabel')</h3>
            <span className="pe-mcp-section-hint">{t("plugin:mcp.userHint")}</span>
          </div>
          {userMcps.map((mcp) => {
            const isEnabled = !(disabledMcpServers["__user__"] ?? []).includes(mcp.name);
            return (
              <div
                key={mcp.name}
                className={`local-item${isEnabled ? " enabled" : ""}`}
                title={mcpTitle(mcp)}
              >
                <label
                  className="toggle-switch"
                  onClick={(e) => e.stopPropagation()}
                  title={isEnabled ? t("plugin:mcp.disableMcpForProfile") : t("plugin:mcp.enableMcpForProfile")}
                >
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={(e) => onToggleMcp("__user__", mcp.name, e.target.checked)}
                    aria-label={`${isEnabled ? t("plugin:mcp.disableMcp") : t("plugin:mcp.enableMcp")} — ${mcp.name}`}
                  />
                  <span className="toggle-track">
                    <span className="toggle-thumb" />
                  </span>
                </label>
                <span className="local-item-name">{mcp.name}</span>
                <span className="pe-mcp-source">{t("plugin:mcp.globalLabel")}</span>
                <span className="plugin-badge">{mcp.type}</span>
              </div>
            );
          })}
        </div>
      )}

      {projectMcps.length > 0 && (
        <div className="pe-mcp-section pe-mcp-section-project">
          <div className="pe-mcp-section-head">
            <h3 className="pe-mcp-section-label">
              {t("plugin:mcp.projectLabel", { dir: launchDir ? launchDir.split("/").pop() ?? launchDir : "", count: projectMcps.length })}
            </h3>
            <span className="pe-mcp-section-hint">{t("plugin:mcp.projectTogglesHint")}</span>
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
                  title={isEnabled ? t("plugin:mcp.disableMcp") : t("plugin:mcp.enableMcp")}
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
