import React, { useState } from "react";
import type { PluginWithItems, Profile } from "../../electron/types";
import { ConfirmDialog } from "./shared/ConfirmDialog";

interface Props {
  plugin: PluginWithItems | null;
  profiles: Profile[];
  availableUpdate: string | null;
  onUpdate: (name: string) => Promise<void>;
  onUninstall: (name: string) => Promise<void>;
  onNavigateToProfile: (profileName: string) => void;
}

function CollapsibleSection({
  label,
  count,
  color,
  children,
}: {
  label: string;
  count: number;
  color: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  if (count === 0) return null;

  return (
    <div className="pm-section">
      <button className="pm-section-header" onClick={() => setOpen(!open)}>
        <span className={`pm-section-arrow${open ? " open" : ""}`}>&#9654;</span>
        <span style={{ color }}>{label}</span>
        <span className="pm-section-count">{count}</span>
      </button>
      {open && <div className="pm-section-items">{children}</div>}
    </div>
  );
}

export function PluginManager({
  plugin,
  profiles,
  availableUpdate,
  onUpdate,
  onUninstall,
  onNavigateToProfile,
}: Props) {
  const [updating, setUpdating] = useState(false);
  const [uninstalling, setUninstalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  if (!plugin) {
    return (
      <div className="pm-empty">
        <div className="empty-state">
          <div className="empty-state-title">Select a plugin to view details</div>
        </div>
      </div>
    );
  }

  const usedByProfiles = profiles.filter((p) => p.plugins.includes(plugin.name));

  const skills = plugin.items.filter((i) => i.type === "skill");
  const agents = plugin.items.filter((i) => i.type === "agent");
  const commands = plugin.items.filter((i) => i.type === "command");
  const hooks = plugin.hooks;
  const mcps = plugin.mcpServers;

  const handleUpdate = async () => {
    setUpdating(true);
    setError(null);
    try {
      await onUpdate(plugin.name);
    } catch (err: any) {
      setError(err?.message ?? "Update failed");
    } finally {
      setUpdating(false);
    }
  };

  const handleUninstall = async () => {
    setShowConfirm(false);
    setUninstalling(true);
    setError(null);
    try {
      await onUninstall(plugin.name);
    } catch (err: any) {
      setError(err?.message ?? "Uninstall failed");
      setUninstalling(false);
    }
  };

  return (
    <div className="pm-detail">
      {/* Error banner */}
      {error && (
        <div className="pe-error-banner">
          <span>{error}</span>
          <button onClick={() => setError(null)}>&times;</button>
        </div>
      )}

      {/* Header */}
      <div className="pm-header">
        <div>
          <h2 className="pm-name">{plugin.pluginName}</h2>
          <div className="pm-subtitle">
            {plugin.marketplace} &middot; v{plugin.version}
          </div>
        </div>
        <div className="pm-actions">
          {availableUpdate && (
            <button
              className="btn-update"
              onClick={handleUpdate}
              disabled={updating}
            >
              {updating ? "Updating..." : `Update to v${availableUpdate}`}
            </button>
          )}
          <button
            className="btn-uninstall"
            onClick={() => setShowConfirm(true)}
            disabled={uninstalling}
          >
            {uninstalling ? "Removing..." : "Uninstall"}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="pm-stats">
        {skills.length > 0 && (
          <span className="plugin-badge skill-badge">
            {skills.length} skill{skills.length !== 1 ? "s" : ""}
          </span>
        )}
        {agents.length > 0 && (
          <span className="plugin-badge agent-badge">
            {agents.length} agent{agents.length !== 1 ? "s" : ""}
          </span>
        )}
        {commands.length > 0 && (
          <span className="plugin-badge cmd-badge">
            {commands.length} cmd{commands.length !== 1 ? "s" : ""}
          </span>
        )}
        {hooks.length > 0 && (
          <span className="plugin-badge hook-badge">
            {hooks.length} hook{hooks.length !== 1 ? "s" : ""}
          </span>
        )}
        {mcps.length > 0 && (
          <span className="plugin-badge mcp">
            {mcps.length} MCP
          </span>
        )}
      </div>

      {/* Used by */}
      {usedByProfiles.length > 0 && (
        <div className="pm-used-by">
          <div className="pm-label">Used by</div>
          <div className="pm-profile-chips">
            {usedByProfiles.map((p) => (
              <button
                key={p.name}
                className="pm-profile-chip"
                onClick={() => onNavigateToProfile(p.name)}
              >
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Contents */}
      <div className="pm-contents">
        <div className="pm-label">Contents</div>

        <CollapsibleSection label="Skills" count={skills.length} color="var(--color-skill)">
          {skills.map((item) => (
            <div key={item.name} className="pm-item">
              <span className="pm-item-name">{item.name}</span>
              <span className="pm-item-desc">{item.description}</span>
            </div>
          ))}
        </CollapsibleSection>

        <CollapsibleSection label="Agents" count={agents.length} color="var(--color-agent)">
          {agents.map((item) => (
            <div key={item.name} className="pm-item">
              <span className="pm-item-name">{item.name}</span>
              <span className="pm-item-desc">{item.description}</span>
            </div>
          ))}
        </CollapsibleSection>

        <CollapsibleSection label="Commands" count={commands.length} color="var(--color-command)">
          {commands.map((item) => (
            <div key={item.name} className="pm-item">
              <span className="pm-item-name">{item.name}</span>
              <span className="pm-item-desc">{item.description}</span>
            </div>
          ))}
        </CollapsibleSection>

        <CollapsibleSection label="Hooks" count={hooks.length} color="var(--color-command)">
          {hooks.map((hook, i) => (
            <div key={i} className="pm-item">
              <span className="pm-item-name">{hook.event}</span>
              <span className="pm-item-desc">{hook.command}</span>
            </div>
          ))}
        </CollapsibleSection>

        <CollapsibleSection label="MCP Servers" count={mcps.length} color="var(--color-command)">
          {mcps.map((mcp) => (
            <div key={mcp.name} className="pm-item">
              <span className="pm-item-name">{mcp.name}</span>
              <span className="pm-item-desc">{mcp.type}</span>
            </div>
          ))}
        </CollapsibleSection>
      </div>

      {/* Uninstall confirmation modal */}
      {showConfirm && (
        <ConfirmDialog
          title={`Uninstall ${plugin.pluginName}?`}
          description={
            usedByProfiles.length > 0
              ? `This plugin is used by ${usedByProfiles.length} profile${usedByProfiles.length !== 1 ? "s" : ""} (${usedByProfiles.map((p) => p.name).join(", ")}). They will show as unhealthy after removal.`
              : "This plugin is not used by any profiles."
          }
          confirmLabel="Uninstall"
          onConfirm={handleUninstall}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
