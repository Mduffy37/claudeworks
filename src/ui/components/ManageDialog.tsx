import React, { useState, useEffect, useRef } from "react";
import { PluginList } from "./PluginList";
import { PluginManager } from "./PluginManager";
import type { PluginWithItems, Profile } from "../../electron/types";

type ManageTab = "plugins" | "projects" | "global";

interface Props {
  plugins: PluginWithItems[];
  profiles: Profile[];
  availableUpdates: Record<string, string>;
  onUpdate: (name: string) => Promise<void>;
  onUninstall: (name: string) => Promise<void>;
  onNavigateToProfile: (profileName: string) => void;
  onClose: () => void;
}

// ─── Projects tab ───────────────────────────────────────────────────────────

function ProjectsTab() {
  const [projects, setProjects] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [claudeMd, setClaudeMd] = useState("");
  const [claudeMdDirty, setClaudeMdDirty] = useState(false);

  useEffect(() => {
    window.api.getImportedProjects().then(setProjects);
  }, []);

  useEffect(() => {
    if (selected) {
      window.api.getProjectClaudeMd(selected).then((content) => {
        setClaudeMd(content);
        setClaudeMdDirty(false);
      });
    } else {
      setClaudeMd("");
      setClaudeMdDirty(false);
    }
  }, [selected]);

  const handleAdd = async () => {
    const dir = await window.api.selectDirectory();
    if (dir) {
      const updated = await window.api.addImportedProject(dir);
      setProjects(updated);
      setSelected(dir);
    }
  };

  const handleRemove = async (dir: string) => {
    const updated = await window.api.removeImportedProject(dir);
    setProjects(updated);
    if (selected === dir) setSelected(null);
  };

  const handleSaveClaudeMd = async () => {
    if (!selected) return;
    await window.api.saveProjectClaudeMd(selected, claudeMd);
    setClaudeMdDirty(false);
  };

  const shortPath = (dir: string) => {
    const parts = dir.split("/").filter(Boolean);
    return parts.length <= 1 ? dir : parts[parts.length - 1];
  };

  return (
    <div className="manage-dialog-split">
      <div className="manage-dialog-sidebar">
        <div className="manage-projects-header">
          <span className="manage-projects-title">Projects</span>
          <button className="btn-icon" onClick={handleAdd} title="Add project" aria-label="Add project">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="manage-projects-list">
          {projects.length === 0 ? (
            <div className="manage-projects-empty">
              No projects imported. Click + to add a project directory.
            </div>
          ) : (
            projects.map((dir) => (
              <div
                key={dir}
                className={`manage-project-item${selected === dir ? " selected" : ""}`}
                onClick={() => setSelected(dir)}
              >
                <div className="manage-project-name">{shortPath(dir)}</div>
                <div className="manage-project-path">{dir}</div>
                <button
                  className="manage-project-remove"
                  onClick={(e) => { e.stopPropagation(); handleRemove(dir); }}
                  title="Remove project"
                >
                  &times;
                </button>
              </div>
            ))
          )}
        </div>
      </div>
      <div className="manage-dialog-content">
        {selected ? (
          <div className="manage-project-detail">
            <div className="manage-section">
              <div className="manage-section-header">
                <span className="manage-section-label">CLAUDE.md</span>
                {claudeMdDirty && (
                  <button className="btn-primary" style={{ fontSize: "11px", padding: "3px 10px" }} onClick={handleSaveClaudeMd}>
                    Save
                  </button>
                )}
              </div>
              <textarea
                className="manage-claudemd-editor"
                value={claudeMd}
                onChange={(e) => { setClaudeMd(e.target.value); setClaudeMdDirty(true); }}
                placeholder="Project-level instructions for Claude Code..."
              />
            </div>
          </div>
        ) : (
          <div className="pm-empty">
            <div className="empty-state">
              <div className="empty-state-icon">&#9671;</div>
              <div className="empty-state-title">Select a project</div>
              <div className="empty-state-body">
                Choose a project from the list, or add one to manage its CLAUDE.md and local add-ons.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Global settings tab ────────────────────────────────────────────────────

function GlobalSettingsTab() {
  const [claudeMd, setClaudeMd] = useState("");
  const [claudeMdDirty, setClaudeMdDirty] = useState(false);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [defaultsDirty, setDefaultsDirty] = useState(false);

  useEffect(() => {
    window.api.getGlobalClaudeMd().then((content) => {
      setClaudeMd(content);
      setClaudeMdDirty(false);
    });
    window.api.getGlobalDefaults().then((d) => {
      setModel(d.model);
      setEffort(d.effortLevel);
      setDefaultsDirty(false);
    });
  }, []);

  const handleSaveClaudeMd = async () => {
    await window.api.saveGlobalClaudeMd(claudeMd);
    setClaudeMdDirty(false);
  };

  const handleSaveDefaults = async () => {
    await window.api.saveGlobalDefaults({ model, effortLevel: effort });
    setDefaultsDirty(false);
  };

  return (
    <div className="manage-global-settings">
      <div className="manage-section">
        <div className="manage-section-header">
          <span className="manage-section-label">Global CLAUDE.md</span>
          {claudeMdDirty && (
            <button className="btn-primary" style={{ fontSize: "11px", padding: "3px 10px" }} onClick={handleSaveClaudeMd}>
              Save
            </button>
          )}
        </div>
        <div className="manage-section-hint">
          Instructions that apply to every Claude Code session, regardless of profile.
        </div>
        <textarea
          className="manage-claudemd-editor"
          value={claudeMd}
          onChange={(e) => { setClaudeMd(e.target.value); setClaudeMdDirty(true); }}
          placeholder="Global instructions for all Claude Code sessions..."
        />
      </div>

      <div className="manage-section">
        <div className="manage-section-header">
          <span className="manage-section-label">Default Model &amp; Effort</span>
          {defaultsDirty && (
            <button className="btn-primary" style={{ fontSize: "11px", padding: "3px 10px" }} onClick={handleSaveDefaults}>
              Save
            </button>
          )}
        </div>
        <div className="manage-section-hint">
          Fallback values used when a profile doesn't specify its own.
        </div>
        <div className="manage-defaults-row">
          <div className="field">
            <label>Model</label>
            <select value={model} onChange={(e) => { setModel(e.target.value); setDefaultsDirty(true); }}>
              <option value="">System default</option>
              <option value="opus">Opus</option>
              <option value="sonnet">Sonnet</option>
              <option value="haiku">Haiku</option>
            </select>
          </div>
          <div className="field">
            <label>Effort Level</label>
            <select value={effort} onChange={(e) => { setEffort(e.target.value); setDefaultsDirty(true); }}>
              <option value="">System default</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="max">Max</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Main dialog ────────────────────────────────────────────────────────────

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
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const selectedPluginData = plugins.find((p) => p.name === selectedPlugin) ?? null;

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="manage-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Configure Claude"
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
            <button
              className={`manage-dialog-tab${activeTab === "projects" ? " active" : ""}`}
              onClick={() => setActiveTab("projects")}
            >
              Projects
            </button>
            <button
              className={`manage-dialog-tab${activeTab === "global" ? " active" : ""}`}
              onClick={() => setActiveTab("global")}
            >
              Global
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

          {activeTab === "projects" && <ProjectsTab />}

          {activeTab === "global" && <GlobalSettingsTab />}
        </div>
      </div>
    </div>
  );
}
