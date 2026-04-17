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
  favouritePlugins?: string[];
  onToggleFavourite?: (pluginName: string) => void;
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
  favouritePlugins,
  onToggleFavourite,
}: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [enabledOnly, setEnabledOnly] = useState(false);

  const toggleExpand = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const isMcpOnly = (p: PluginWithItems) =>
    p.items.length === 0 && p.mcpServers.length > 0;

  const isLocal = (p: PluginWithItems) => p.marketplace === "local";
  const isFramework = (p: PluginWithItems) => p.marketplace === "framework";

  const matchesEnabled = (p: PluginWithItems) => !enabledOnly || selectedPlugins.includes(p.name);

  const globalPlugins = useMemo(() => {
    const q = search.toLowerCase().trim();
    return plugins.filter((p) => p.scope === "user" && !isLocal(p) && !isFramework(p) && !isMcpOnly(p) && matchesEnabled(p) && (!q || p.pluginName.toLowerCase().includes(q)))
      .sort((a, b) => {
        const aFav = favouritePlugins?.includes(a.name) ? 0 : 1;
        const bFav = favouritePlugins?.includes(b.name) ? 0 : 1;
        return aFav - bFav;
      });
  }, [plugins, search, favouritePlugins, enabledOnly, selectedPlugins]);

  const frameworkPlugins = useMemo(() => {
    const q = search.toLowerCase().trim();
    return plugins.filter((p) => isFramework(p) && matchesEnabled(p) && (!q || p.pluginName.toLowerCase().includes(q)))
      .sort((a, b) => {
        const aFav = favouritePlugins?.includes(a.name) ? 0 : 1;
        const bFav = favouritePlugins?.includes(b.name) ? 0 : 1;
        return aFav - bFav;
      });
  }, [plugins, search, favouritePlugins, enabledOnly, selectedPlugins]);

  const userLocalPlugins = useMemo(() => {
    const q = search.toLowerCase().trim();
    return plugins.filter((p) => isLocal(p) && matchesEnabled(p) && (!q || p.pluginName.toLowerCase().includes(q)))
      .sort((a, b) => {
        const aFav = favouritePlugins?.includes(a.name) ? 0 : 1;
        const bFav = favouritePlugins?.includes(b.name) ? 0 : 1;
        return aFav - bFav;
      });
  }, [plugins, search, favouritePlugins, enabledOnly, selectedPlugins]);

  const localPlugins = useMemo(() => {
    const q = search.toLowerCase().trim();
    return plugins.filter((p) => p.scope === "project" && p.projectPath === directory && !isMcpOnly(p) && matchesEnabled(p) && (!q || p.pluginName.toLowerCase().includes(q)))
      .sort((a, b) => {
        const aFav = favouritePlugins?.includes(a.name) ? 0 : 1;
        const bFav = favouritePlugins?.includes(b.name) ? 0 : 1;
        return aFav - bFav;
      });
  }, [plugins, directory, search, favouritePlugins, enabledOnly, selectedPlugins]);

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

    const sourceLabel = plugin.marketplace && plugin.marketplace !== "local" && plugin.marketplace !== "builtin"
      ? `from marketplace ${plugin.marketplace}`
      : plugin.source?.type === "skillfish"
        ? "installed via skillfish"
        : plugin.source?.type === "git"
          ? "git-managed"
          : plugin.marketplace === "builtin"
            ? "built-in"
            : "local";
    const versionLabel = plugin.marketplace !== "local" ? `version ${plugin.version}` : "";
    const rowLabel = [plugin.pluginName, versionLabel, sourceLabel, enabled ? "enabled" : "disabled"]
      .filter(Boolean)
      .join(", ");
    return (
      <div
        key={plugin.name}
        role="listitem"
        aria-label={rowLabel}
        className={`plugin-row${enabled ? " enabled" : ""}`}
      >
        <div className="plugin-header" onClick={() => toggleExpand(plugin.name)}>
          {/* Toggle switch — stop propagation so it doesn't also expand/collapse */}
          <label
            className="toggle-switch"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => onTogglePlugin(plugin.name, e.target.checked)}
              aria-label={`${enabled ? "Disable" : "Enable"} plugin ${plugin.pluginName}`}
            />
            <span className="toggle-track">
              <span className="toggle-thumb" />
            </span>
          </label>

          {/* Expand arrow */}
          <span className={`plugin-expand${isExpanded ? " is-expanded" : ""}`}>
            <ChevronIcon />
          </span>

          <div className="plugin-header-body">
            <span className="plugin-name">
              {plugin.pluginName}
              {plugin.marketplace !== "local" && (
                <span className="plugin-version">v{plugin.version}</span>
              )}
              {plugin.marketplace && plugin.marketplace !== "local" && plugin.marketplace !== "builtin" && (
                <span
                  className="plugin-source plugin-source-marketplace"
                  title={`From marketplace: ${plugin.marketplace}`}
                >
                  {plugin.marketplace}
                </span>
              )}
              {plugin.source?.type === "skillfish" && (
                <span
                  className="plugin-source plugin-source-skillfish"
                  title={
                    plugin.source.metadata?.owner && plugin.source.metadata?.repo
                      ? `Installed by skillfish from ${plugin.source.metadata.owner}/${plugin.source.metadata.repo}`
                      : "Installed by skillfish"
                  }
                >
                  skillfish
                </span>
              )}
              {plugin.source?.type === "git" && (
                <span
                  className="plugin-source plugin-source-git"
                  title={(() => {
                    const m = plugin.source.metadata ?? {};
                    const ownerRepo = m.owner && m.repo ? `${m.owner}/${m.repo}` : m.url ?? "unknown";
                    const branch = m.branch ? ` · ${m.branch}` : "";
                    return `Git-managed skill from ${ownerRepo}${branch}`;
                  })()}
                >
                  git
                </span>
              )}
              {plugin.source &&
                plugin.source.type !== "skillfish" &&
                plugin.source.type !== "git" && (
                  <span
                    className={`plugin-source plugin-source-${plugin.source.type}`}
                    title={plugin.source.tooltip ?? `Installed by ${plugin.source.type}`}
                  >
                    {plugin.source.label ?? plugin.source.type}
                  </span>
                )}
            </span>

            {/* Badge row — always visible type breakdown */}
            {(() => {
              const skills = plugin.items.filter((i) => i.type === "skill").length;
              const agents = plugin.items.filter((i) => i.type === "agent").length;
              const commands = plugin.items.filter((i) => i.type === "command").length;
              const hooks = plugin.hooks.length;
              const mcps = plugin.mcpServers.length;
              const hasNothing = !skills && !agents && !commands && !hooks && !mcps;
              return (
                <span className="plugin-badge-row">
                  {skills > 0 && <span className="plugin-badge skill-badge">{skills} skill{skills !== 1 ? "s" : ""}</span>}
                  {agents > 0 && <span className="plugin-badge agent-badge">{agents} agent{agents !== 1 ? "s" : ""}</span>}
                  {commands > 0 && <span className="plugin-badge cmd-badge">{commands} cmd{commands !== 1 ? "s" : ""}</span>}
                  {hooks > 0 && <span className="plugin-badge hook-badge">{hooks} hook{hooks !== 1 ? "s" : ""}</span>}
                  {mcps > 0 && <span className="plugin-badge mcp">{mcps} MCP</span>}
                  {hasNothing && <span className="plugin-badge">LSP</span>}
                  {excludedCount > 0 && enabled && (
                    <span className="plugin-badge excluded">{excludedCount} excluded</span>
                  )}
                </span>
              );
            })()}
          </div>

          {/* Favourite star — far right */}
          {onToggleFavourite && (
            <button
              className={`plugin-fav-btn${favouritePlugins?.includes(plugin.name) ? " active" : ""}`}
              onClick={(e) => { e.stopPropagation(); onToggleFavourite(plugin.name); }}
              title={favouritePlugins?.includes(plugin.name) ? "Remove from favourites" : "Add to favourites"}
              aria-label={favouritePlugins?.includes(plugin.name) ? "Unfavourite" : "Favourite"}
            >
              {favouritePlugins?.includes(plugin.name) ? "\u2605" : "\u2606"}
            </button>
          )}
        </div>

        {isExpanded && (
          <div className="plugin-items">
            {plugin.items.length === 0 && plugin.hooks.length === 0 ? (
              <div className="empty-state-inline">No configurable items</div>
            ) : plugin.items.length === 0 ? null : (
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
            {plugin.hooks.length > 0 && (
              <div className="mcp-servers">
                <div className="skill-group-label" style={{ color: "var(--color-hook, var(--text-muted))" }}>
                  <span className="skill-group-label-dot" />
                  Hooks
                  <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>
                    &nbsp;{plugin.hooks.length}
                  </span>
                </div>
                {plugin.hooks.map((hook, i) => (
                  <div key={`${hook.event}-${i}`} className="mcp-server-item">
                    <span className="mcp-server-name">{hook.event}</span>
                    <span className="plugin-badge" style={{ fontFamily: '"SF Mono", monospace', fontSize: "0.692rem" }}>{hook.command}</span>
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
      <div className="pl-search" style={{ padding: "8px 0", display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="text"
          className="pl-search-input"
          placeholder="Search plugins..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: 1 }}
        />
        <button
          type="button"
          className={`btn-secondary pl-filter-chip${enabledOnly ? " active" : ""}`}
          onClick={() => setEnabledOnly((v) => !v)}
          aria-pressed={enabledOnly}
          title={enabledOnly ? "Show all plugins" : "Show only plugins enabled in this profile"}
        >
          Enabled only
        </button>
      </div>
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
          <div role="list" aria-label="Global plugins">{globalPlugins.map(renderPlugin)}</div>
        )}
      </div>

      {frameworkPlugins.length > 0 && (
        <div className="plugin-section">
          <div className="plugin-section-header">
            <h3>Frameworks</h3>
            <span className="plugin-section-count">{frameworkPlugins.length}</span>
          </div>
          <div role="list" aria-label="Frameworks">{frameworkPlugins.map(renderPlugin)}</div>
        </div>
      )}

      {userLocalPlugins.length > 0 && (
        <div className="plugin-section">
          <div className="plugin-section-header">
            <h3>Local</h3>
            <span className="plugin-section-count">{userLocalPlugins.length}</span>
          </div>
          <div role="list" aria-label="Local plugins">{userLocalPlugins.map(renderPlugin)}</div>
        </div>
      )}

      {directory && (
        <div className="plugin-section">
          <div className="plugin-section-header">
            <h3>Project Plugins</h3>
            {localPlugins.length > 0 && (
              <span className="plugin-section-count">{localPlugins.length}</span>
            )}
          </div>
          {localPlugins.length === 0 ? (
            <div className="empty-state-inline">
              No plugins installed for {directory}
            </div>
          ) : (
            <div role="list" aria-label="Project plugins">{localPlugins.map(renderPlugin)}</div>
          )}
        </div>
      )}
    </div>
  );
}
