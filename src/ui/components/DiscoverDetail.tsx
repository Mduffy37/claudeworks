import React, { useState } from "react";
import type { AvailablePlugin } from "../../electron/types";
import { ConfirmDialog } from "./shared/ConfirmDialog";

interface Props {
  plugin: AvailablePlugin | null;
  isInstalled: boolean;
  onInstall: (pluginId: string) => Promise<void>;
}

function formatCount(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export function DiscoverDetail({ plugin, isInstalled, onInstall }: Props) {
  const [installing, setInstalling] = useState(false);
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

  const handleInstall = async () => {
    setShowConfirm(false);
    setInstalling(true);
    setError(null);
    try {
      await onInstall(plugin.pluginId);
    } catch (err: any) {
      setError(err?.message ?? "Installation failed");
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="pm-detail">
      {error && (
        <div className="pe-error-banner">
          <span>{error}</span>
          <button onClick={() => setError(null)}>&times;</button>
        </div>
      )}

      <div className="pm-header">
        <div>
          <h2 className="pm-name">{plugin.name}</h2>
          <div className="pm-subtitle">
            {plugin.marketplaceName}
          </div>
        </div>
        <div className="pm-actions">
          {isInstalled ? (
            <span className="discover-installed-badge">Installed</span>
          ) : (
            <button
              className="btn-primary"
              onClick={() => setShowConfirm(true)}
              disabled={installing}
            >
              {installing ? "Installing..." : "Install"}
            </button>
          )}
        </div>
      </div>

      <div className="discover-detail-body">
        <div className="discover-detail-description">{plugin.description}</div>

        <div className="discover-detail-stats">
          <div className="discover-stat">
            <div className="discover-stat-value">{formatCount(plugin.installCount)}</div>
            <div className="discover-stat-label">installs</div>
          </div>
        </div>

        {plugin.source.url && (
          <div className="discover-detail-section">
            <div className="pm-label">Source</div>
            <a
              href={plugin.source.url}
              className="discover-source-link"
              onClick={(e) => {
                e.preventDefault();
                window.open(plugin.source.url!, "_blank");
              }}
            >
              {plugin.source.url.replace("https://github.com/", "").replace(".git", "")}
            </a>
          </div>
        )}
      </div>

      {showConfirm && (
        <ConfirmDialog
          title={`Install ${plugin.name}?`}
          description={`Install "${plugin.name}" from ${plugin.marketplaceName}? This will download and install the plugin globally.`}
          confirmLabel="Install"
          confirmVariant="primary"
          onConfirm={handleInstall}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
