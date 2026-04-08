import React, { useState, useEffect, useRef } from "react";
import { PluginList } from "./PluginList";
import { PluginManager } from "./PluginManager";
import type { PluginWithItems, Profile } from "../../electron/types";

type ManageTab = "plugins";

interface Props {
  plugins: PluginWithItems[];
  profiles: Profile[];
  availableUpdates: Record<string, string>;
  onUpdate: (name: string) => Promise<void>;
  onUninstall: (name: string) => Promise<void>;
  onNavigateToProfile: (profileName: string) => void;
  onClose: () => void;
}

export function ManageDialog({
  plugins,
  profiles,
  availableUpdates,
  onUpdate,
  onUninstall,
  onNavigateToProfile,
  onClose,
}: Props) {
  const [activeTab, setActiveTab] = useState<ManageTab>("plugins");
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const selectedPluginData = plugins.find((p) => p.name === selectedPlugin) ?? null;

  return (
    <div className="modal-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="manage-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Manage"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="manage-dialog-header">
          <div className="manage-dialog-tabs">
            <button
              className={`manage-dialog-tab${activeTab === "plugins" ? " active" : ""}`}
              onClick={() => setActiveTab("plugins")}
            >
              Plugins
            </button>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="manage-dialog-body">
          {activeTab === "plugins" && (
            <div className="manage-dialog-split">
              <div className="manage-dialog-sidebar">
                <PluginList
                  plugins={plugins}
                  selectedPlugin={selectedPlugin}
                  availableUpdates={availableUpdates}
                  onSelect={setSelectedPlugin}
                />
              </div>
              <div className="manage-dialog-content">
                <PluginManager
                  plugin={selectedPluginData}
                  profiles={profiles}
                  availableUpdate={selectedPlugin ? (availableUpdates[selectedPlugin] ?? null) : null}
                  onUpdate={onUpdate}
                  onUninstall={onUninstall}
                  onNavigateToProfile={(name) => { onClose(); onNavigateToProfile(name); }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
