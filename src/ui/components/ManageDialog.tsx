import React, { useState, useEffect, useRef, useMemo } from "react";
import { PluginList } from "./PluginList";
import { PluginManager } from "./PluginManager";
import { DiscoverList } from "./DiscoverList";
import { DiscoverDetail } from "./DiscoverDetail";
import type { PluginWithItems, Profile, Prompt, AvailablePlugin, CuratedPlugin, CuratedMarketplace, CuratedCollection, CuratedMarketplaceData, CuratedIndex, CuratedIndexEntry } from "../../electron/types";
import { PromptPicker } from "./PromptPicker";
import { CuratedDetailModal } from "./CuratedDetailModal";
import { ConfirmDialog } from "./shared/ConfirmDialog";
import { StatusBarTab } from "./configure/StatusBarTab";

type CuratedDetailTarget =
  | { kind: "marketplace"; entry: CuratedMarketplace }
  | { kind: "plugin"; entry: CuratedPlugin };

/**
 * Renders a small SVG glyph for a collection icon name. Keeps each icon
 * self-contained — no icon library dep, matches the existing stroke-based
 * style (1.3px strokes, currentColor) used elsewhere in the app.
 * Unknown names fall back to a generic dot so collections with a new icon
 * still render something rather than literal text.
 */
function CollectionIcon({ name, size = 12 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.3,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className: "curated-collection-icon",
  };
  switch (name) {
    case "bolt":
      return (
        <svg {...common}>
          <path d="M9 1L3 9h4l-1 6 6-8H8l1-6z" />
        </svg>
      );
    case "arrows":
      return (
        <svg {...common}>
          <path d="M3 6h10M13 6l-2-2M13 6l-2 2" />
          <path d="M13 10H3M3 10l2-2M3 10l2 2" />
        </svg>
      );
    case "code":
      return (
        <svg {...common}>
          <path d="M5 4L2 8l3 4M11 4l3 4-3 4M9 3l-2 10" />
        </svg>
      );
    case "palette":
      return (
        <svg {...common}>
          <path d="M8 1.5a6.5 6.5 0 000 13c1 0 1.5-.5 1.5-1.2 0-.6-.3-.8-.3-1.2 0-.5.4-.9.9-.9h1.4c1.7 0 3-1.3 3-3A6.5 6.5 0 008 1.5z" />
          <circle cx="5" cy="7" r=".7" fill="currentColor" />
          <circle cx="8" cy="4.5" r=".7" fill="currentColor" />
          <circle cx="11" cy="7" r=".7" fill="currentColor" />
        </svg>
      );
    case "layers":
      return (
        <svg {...common}>
          <path d="M8 2L2 5l6 3 6-3-6-3z" />
          <path d="M2 8l6 3 6-3M2 11l6 3 6-3" />
        </svg>
      );
    case "database":
      return (
        <svg {...common}>
          <ellipse cx="8" cy="3.5" rx="5" ry="1.5" />
          <path d="M3 3.5v9c0 .83 2.24 1.5 5 1.5s5-.67 5-1.5v-9" />
          <path d="M3 8c0 .83 2.24 1.5 5 1.5s5-.67 5-1.5" />
        </svg>
      );
    case "cloud":
      return (
        <svg {...common}>
          <path d="M4.5 12a3 3 0 01.5-5.95A3.5 3.5 0 0111.5 6a3 3 0 01.5 6H4.5z" />
        </svg>
      );
    case "smartphone":
      return (
        <svg {...common}>
          <rect x="4.5" y="2" width="7" height="12" rx="1" />
          <path d="M7 12h2" />
        </svg>
      );
    case "sparkles":
      return (
        <svg {...common}>
          <path d="M5 1.5v3M3.5 3h3" />
          <path d="M11 7.5v4M9 9.5h4" />
          <path d="M11 2v1.5M10.25 2.75h1.5" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M8 1.5l5 1.5v5c0 3-2.2 5.5-5 6-2.8-.5-5-3-5-6v-5l5-1.5z" />
        </svg>
      );
    case "bar-chart":
      return (
        <svg {...common}>
          <path d="M2 14h12" />
          <path d="M4 14V9M8 14V5M12 14V7" />
        </svg>
      );
    case "credit-card":
      return (
        <svg {...common}>
          <rect x="2" y="4" width="12" height="8" rx="1" />
          <path d="M2 7h12M4.5 10h2" />
        </svg>
      );
    case "target":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <circle cx="8" cy="8" r="3.5" />
          <circle cx="8" cy="8" r="1" fill="currentColor" />
        </svg>
      );
    case "trending-up":
      return (
        <svg {...common}>
          <path d="M2 12l4-4 3 3 5-5" />
          <path d="M10 6h4v4" />
        </svg>
      );
    case "edit":
      return (
        <svg {...common}>
          <path d="M11 2l3 3-8 8H3v-3l8-8z" />
          <path d="M10 3l3 3" />
        </svg>
      );
    case "activity":
      return (
        <svg {...common}>
          <path d="M2 8h3l2-5 3 10 2-5h2" />
        </svg>
      );
    case "check-circle":
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="6" />
          <path d="M5.5 8l2 2 3.5-3.5" />
        </svg>
      );
    case "scale":
      return (
        <svg {...common}>
          <path d="M8 3v11M4 14h8M8 3h-2M8 3h2" />
          <path d="M3 6l-1 4h2zM13 6l-1 4h2z" />
          <path d="M3 6h10" />
        </svg>
      );
    case "box":
      return (
        <svg {...common}>
          <path d="M2 5l6-3 6 3v6l-6 3-6-3V5z" />
          <path d="M2 5l6 3 6-3M8 8v6" />
        </svg>
      );
    case "cpu":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="8" height="8" rx="0.5" />
          <rect x="6" y="6" width="4" height="4" />
          <path d="M6 4V2M10 4V2M6 14v-2M10 14v-2M4 6H2M4 10H2M12 6h2M12 10h2" />
        </svg>
      );
    case "wrench":
      return (
        <svg {...common}>
          <path d="M10 3a3 3 0 013 3 3 3 0 01-.5 1.7l2.5 2.5-1.8 1.8-2.5-2.5A3 3 0 017 6a3 3 0 013-3z" />
          <path d="M7 9l-5 5" />
        </svg>
      );
    case "archive":
      return (
        <svg {...common}>
          <rect x="2" y="3" width="12" height="3" rx="0.5" />
          <path d="M3 6v8h10V6" />
          <path d="M6 9h4" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="8" cy="8" r="2.5" />
        </svg>
      );
  }
}

type ManageTab = "plugins" | "projects" | "global" | "prompts" | "health" | "statusbar";

interface Props {
  plugins: PluginWithItems[];
  profiles: Profile[];
  availableUpdates: Record<string, string>;
  hasDefaultProfile: boolean;
  initialTab?: ManageTab;
  onUpdate: (name: string) => Promise<void>;
  onUninstall: (name: string) => Promise<void>;
  onNavigateToProfile: (profileName: string) => void;
  onCreateDefault: () => void;
  onClose: () => void;
  onPluginsChanged?: () => void;
  /** Bumps each time the top-level hard refresh runs — triggers a re-read of curated caches. */
  curatedRefreshKey?: number;
}

// ─── Projects tab ───────────────────────────────────────────────────────────

// ─── Item editor inline ────────────────────────────────────────────────────

type ItemType = "skill" | "agent" | "command";

function itemRelativePath(type: ItemType, name: string): string {
  if (type === "skill") return `.claude/skills/${name}/SKILL.md`;
  if (type === "agent") return `.claude/agents/${name}.md`;
  return `.claude/commands/${name}.md`;
}

function itemStub(type: ItemType, name: string): string {
  return `---\nname: ${name}\ndescription: \n---\n\n`;
}

function ProjectItemEditor({ dir, type, name, onClose, onRefresh }: {
  dir: string; type: ItemType; name: string; onClose: () => void; onRefresh: () => void;
}) {
  const [content, setContent] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    window.api.readProjectFile(dir, itemRelativePath(type, name)).then((c) => {
      setContent(c);
      setDirty(false);
    });
  }, [dir, type, name]);

  const handleSave = async () => {
    await window.api.writeProjectFile(dir, itemRelativePath(type, name), content);
    setDirty(false);
    onRefresh();
  };

  const handleDelete = async () => {
    if (type === "skill") {
      await window.api.deleteProjectFile(dir, `.claude/skills/${name}`);
    } else {
      await window.api.deleteProjectFile(dir, itemRelativePath(type, name));
    }
    onRefresh();
    onClose();
  };

  return (
    <div className="project-item-editor">
      <div className="manage-section-header">
        <span className="manage-section-label">{type}: {name}</span>
        <div style={{ display: "flex", gap: "6px" }}>
          {dirty && (
            <button className="btn-primary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={handleSave}>Save</button>
          )}
          <button className="btn-secondary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={handleDelete}>Delete</button>
          <button className="btn-secondary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={onClose}>Close</button>
        </div>
      </div>
      <textarea
        className="manage-claudemd-editor"
        value={content}
        onChange={(e) => { setContent(e.target.value); setDirty(true); }}
        placeholder={`${type} content...`}
      />
    </div>
  );
}

// ─── Projects tab ───────────────────────────────────────────────────────────

interface ProjectItem { name: string; type: ItemType; path: string }

function ProjectsTab() {
  const [projects, setProjects] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [claudeMd, setClaudeMd] = useState("");
  const [claudeMdDirty, setClaudeMdDirty] = useState(false);
  const [gitContext, setGitContext] = useState<{ branch: string; dirty: boolean; isRepo: boolean } | null>(null);
  const [showPromptPicker, setShowPromptPicker] = useState(false);
  const [localItems, setLocalItems] = useState<ProjectItem[]>([]);
  const [editingItem, setEditingItem] = useState<{ type: ItemType; name: string } | null>(null);
  const [newItemType, setNewItemType] = useState<ItemType>("skill");
  const [newItemName, setNewItemName] = useState("");
  const [mcpJson, setMcpJson] = useState("");
  const [mcpDirty, setMcpDirty] = useState(false);
  const [mcpError, setMcpError] = useState("");
  const [projSettings, setProjSettings] = useState<Record<string, any>>({});
  const [settingsDirty, setSettingsDirty] = useState(false);
  const [projEnvNewKey, setProjEnvNewKey] = useState("");
  const [projEnvNewVal, setProjEnvNewVal] = useState("");

  useEffect(() => {
    window.api.getImportedProjects().then(setProjects);
  }, []);

  const refreshProjectData = () => {
    if (!selected) return;
    window.api.getProjectClaudeMd(selected).then((c) => { setClaudeMd(c); setClaudeMdDirty(false); });
    window.api.getGitContext(selected).then(setGitContext);
    window.api.getLocalItems(selected).then((items) => setLocalItems(items as ProjectItem[]));
    window.api.getProjectMcpConfig(selected).then((s) => { setMcpJson(JSON.stringify(s, null, 2)); setMcpDirty(false); setMcpError(""); });
    window.api.getProjectSettings(selected).then((s) => { setProjSettings(s); setSettingsDirty(false); });
  };

  useEffect(() => {
    if (selected) {
      refreshProjectData();
      setEditingItem(null);
    } else {
      setClaudeMd(""); setClaudeMdDirty(false); setGitContext(null);
      setLocalItems([]); setEditingItem(null);
      setMcpJson("{}"); setMcpDirty(false); setMcpError("");
      setProjSettings({}); setSettingsDirty(false);
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

  const handleCreateItem = async () => {
    if (!selected || !newItemName.trim()) return;
    const name = newItemName.trim().replace(/\s+/g, "-").toLowerCase();
    await window.api.writeProjectFile(selected, itemRelativePath(newItemType, name), itemStub(newItemType, name));
    setNewItemName("");
    refreshProjectData();
    setEditingItem({ type: newItemType, name });
  };

  const handleSaveMcp = async () => {
    if (!selected) return;
    try {
      const parsed = JSON.parse(mcpJson);
      await window.api.saveProjectMcpConfig(selected, parsed);
      setMcpDirty(false);
      setMcpError("");
    } catch {
      setMcpError("Invalid JSON");
    }
  };

  const handleSaveSettings = async () => {
    if (!selected) return;
    await window.api.saveProjectSettings(selected, projSettings);
    setSettingsDirty(false);
  };

  const shortPath = (dir: string) => {
    const parts = dir.split("/").filter(Boolean);
    return parts.length <= 1 ? dir : parts[parts.length - 1];
  };

  const projEnvEntries = Object.entries(projSettings.env ?? {});

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
            {/* Git context */}
            {gitContext?.isRepo && (
              <div className="manage-section">
                <div className="manage-section-header">
                  <span className="manage-section-label">Git</span>
                </div>
                <div className="manage-project-git">
                  <span className="manage-git-branch">{gitContext.branch}</span>
                  {gitContext.dirty && <span className="manage-git-dirty">uncommitted changes</span>}
                </div>
              </div>
            )}

            {/* Directory buttons */}
            <div className="manage-section">
              <div className="manage-section-header">
                <span className="manage-section-label">Directory</span>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button className="btn-secondary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={() => window.api.openInFinder(selected)}>
                    Open Project
                  </button>
                  <button className="btn-secondary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={() => window.api.openInFinder(selected + "/.claude")}>
                    Open .claude/
                  </button>
                </div>
              </div>
            </div>

            {/* CLAUDE.md */}
            <div className="manage-section">
              <div className="manage-section-header">
                <span className="manage-section-label">CLAUDE.md</span>
                <div style={{ display: "flex", gap: "6px" }}>
                  <button className="insert-prompt-btn" onClick={() => setShowPromptPicker(true)}><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2"/><path d="M6 5h4M6 8h4M6 11h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>Insert Prompt</button>
                  {claudeMdDirty && (
                    <button className="btn-primary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={handleSaveClaudeMd}>
                      Save
                    </button>
                  )}
                </div>
              </div>
              {showPromptPicker && (
                <PromptPicker
                  onSelect={(content) => { setClaudeMd((prev) => prev ? prev + "\n\n" + content : content); setClaudeMdDirty(true); }}
                  onClose={() => setShowPromptPicker(false)}
                />
              )}
              <textarea
                className="manage-claudemd-editor"
                value={claudeMd}
                onChange={(e) => { setClaudeMd(e.target.value); setClaudeMdDirty(true); }}
                placeholder="Project-level instructions for Claude Code..."
              />
            </div>

            {/* Skills / Agents / Commands */}
            <div className="manage-section">
              <div className="manage-section-header">
                <span className="manage-section-label">Skills, Agents &amp; Commands</span>
              </div>
              {localItems.length === 0 && !editingItem ? (
                <div className="manage-section-hint">No items in .claude/ yet. Create one below.</div>
              ) : (
                <div className="project-items-list">
                  {(["skill", "agent", "command"] as const).map((type) => {
                    const items = localItems.filter((i) => i.type === type);
                    if (items.length === 0) return null;
                    return (
                      <div key={type} className="project-items-group">
                        <div className="project-items-group-label">{type === "skill" ? "Skills" : type === "agent" ? "Agents" : "Commands"}</div>
                        {items.map((item) => (
                          <div
                            key={item.path}
                            className={`project-item-row${editingItem?.name === item.name && editingItem?.type === type ? " active" : ""}`}
                            onClick={() => setEditingItem({ type, name: item.name })}
                          >
                            <span className="project-item-name">{type === "command" ? `/${item.name}` : item.name}</span>
                            <span className="plugin-badge">{type}</span>
                          </div>
                        ))}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Inline editor */}
              {editingItem && selected && (
                <ProjectItemEditor
                  dir={selected}
                  type={editingItem.type}
                  name={editingItem.name}
                  onClose={() => setEditingItem(null)}
                  onRefresh={refreshProjectData}
                />
              )}

              {/* Create new */}
              <div className="project-create-row">
                <select value={newItemType} onChange={(e) => setNewItemType(e.target.value as ItemType)}>
                  <option value="skill">Skill</option>
                  <option value="agent">Agent</option>
                  <option value="command">Command</option>
                </select>
                <input
                  type="text"
                  value={newItemName}
                  onChange={(e) => setNewItemName(e.target.value)}
                  placeholder="Name..."
                  onKeyDown={(e) => { if (e.key === "Enter") handleCreateItem(); }}
                />
                <button className="btn-secondary" onClick={handleCreateItem} disabled={!newItemName.trim()}>Create</button>
              </div>
            </div>

            {/* MCP Servers */}
            <div className="manage-section">
              <div className="manage-section-header">
                <span className="manage-section-label">MCP Servers</span>
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  {mcpError && <span style={{ fontSize: "0.846rem", color: "var(--color-danger, #e55)" }}>{mcpError}</span>}
                  {mcpDirty && (
                    <button className="btn-primary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={handleSaveMcp}>Save</button>
                  )}
                </div>
              </div>
              <div className="manage-section-hint">Edit .mcp.json — raw JSON for project-level MCP server configuration.</div>
              <textarea
                className="manage-claudemd-editor"
                style={{ fontFamily: '"SF Mono", "Fira Code", monospace', fontSize: "0.846rem", minHeight: "120px" }}
                value={mcpJson}
                onChange={(e) => { setMcpJson(e.target.value); setMcpDirty(true); setMcpError(""); }}
                placeholder='{ "server-name": { "type": "stdio", "command": "npx", "args": [...] } }'
              />
            </div>

            {/* Project Settings */}
            <div className="manage-section">
              <div className="manage-section-header">
                <span className="manage-section-label">Project Settings</span>
                {settingsDirty && (
                  <button className="btn-primary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={handleSaveSettings}>Save</button>
                )}
              </div>
              <div className="manage-section-hint">Saved to .claude/settings.json — applies to all sessions in this directory.</div>
              <div className="modal-fields" style={{ marginTop: "8px" }}>
                <div className="field">
                  <label>Model</label>
                  <select value={projSettings.model ?? ""} onChange={(e) => { setProjSettings((p) => ({ ...p, model: e.target.value || undefined })); setSettingsDirty(true); }}>
                    <option value="">Default</option>
                    <option value="opus">Opus</option>
                    <option value="sonnet">Sonnet</option>
                    <option value="haiku">Haiku</option>
                  </select>
                </div>
                <div className="field-divider" />
                <div className="field">
                  <label>Effort Level</label>
                  <select value={projSettings.effortLevel ?? ""} onChange={(e) => { setProjSettings((p) => ({ ...p, effortLevel: e.target.value || undefined })); setSettingsDirty(true); }}>
                    <option value="">Default</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="max">Max</option>
                  </select>
                </div>
              </div>
              <div className="modal-fields" style={{ marginTop: "8px" }}>
                <div className="manage-section-label" style={{ padding: 0, margin: 0 }}>Environment Variables</div>
                {projEnvEntries.map(([key, value]) => (
                  <div className="env-var-row" key={key}>
                    <input type="text" value={key} disabled aria-label="Variable name" />
                    <input type="text" value={value as string} onChange={(e) => { setProjSettings((p) => ({ ...p, env: { ...(p.env ?? {}), [key]: e.target.value } })); setSettingsDirty(true); }} placeholder="value" aria-label={`${key} value`} />
                    <button className="btn-secondary" onClick={() => { setProjSettings((p) => { const env = { ...(p.env ?? {}) }; delete env[key]; return { ...p, env: Object.keys(env).length > 0 ? env : undefined }; }); setSettingsDirty(true); }}>Remove</button>
                  </div>
                ))}
                {projEnvEntries.length > 0 && <div className="field-divider" />}
                <div className="env-var-row">
                  <input type="text" value={projEnvNewKey} onChange={(e) => setProjEnvNewKey(e.target.value.replace(/\s/g, ""))} placeholder="NEW_VAR_NAME" aria-label="New variable name" onKeyDown={(e) => { if (e.key === "Enter" && projEnvNewKey.trim()) { setProjSettings((p) => ({ ...p, env: { ...(p.env ?? {}), [projEnvNewKey.trim()]: projEnvNewVal } })); setProjEnvNewKey(""); setProjEnvNewVal(""); setSettingsDirty(true); } }} />
                  <input type="text" value={projEnvNewVal} onChange={(e) => setProjEnvNewVal(e.target.value)} placeholder="value" aria-label="New variable value" onKeyDown={(e) => { if (e.key === "Enter" && projEnvNewKey.trim()) { setProjSettings((p) => ({ ...p, env: { ...(p.env ?? {}), [projEnvNewKey.trim()]: projEnvNewVal } })); setProjEnvNewKey(""); setProjEnvNewVal(""); setSettingsDirty(true); } }} />
                  <button className="btn-secondary" disabled={!projEnvNewKey.trim()} onClick={() => { setProjSettings((p) => ({ ...p, env: { ...(p.env ?? {}), [projEnvNewKey.trim()]: projEnvNewVal } })); setProjEnvNewKey(""); setProjEnvNewVal(""); setSettingsDirty(true); }}>Add</button>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="pm-empty">
            <div className="empty-state">
              <div className="empty-state-icon">&#9671;</div>
              <div className="empty-state-title">Select a project</div>
              <div className="empty-state-body">
                Choose a project from the list, or add one to manage its CLAUDE.md, skills, MCP servers, and settings.
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
  const [opusContext, setOpusContext] = useState<"200k" | "1m" | undefined>(undefined);
  const [sonnetContext, setSonnetContext] = useState<"200k" | "1m" | undefined>(undefined);
  const [effort, setEffort] = useState("");
  const [env, setEnv] = useState<Record<string, string>>({});
  const [envDirty, setEnvDirty] = useState(false);
  const [customFlags, setCustomFlags] = useState("");
  const [defaultsDirty, setDefaultsDirty] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [hooksJson, setHooksJson] = useState("");
  const [hooksDirty, setHooksDirty] = useState(false);
  const [hooksError, setHooksError] = useState("");
  const [showPromptPicker, setShowPromptPicker] = useState(false);
  const [terminalApp, setTerminalApp] = useState("");
  const [tmuxMode, setTmuxMode] = useState("");
  const [tmuxInstalled, setTmuxInstalled] = useState(true);

  useEffect(() => {
    window.api.getGlobalClaudeMd().then((content) => {
      setClaudeMd(content);
      setClaudeMdDirty(false);
    });
    window.api.getGlobalHooks().then((h) => {
      setHooksJson(JSON.stringify(h, null, 2));
      setHooksDirty(false);
      setHooksError("");
    });
    window.api.getGlobalEnv().then((e) => {
      setEnv(e);
      setEnvDirty(false);
    });
    Promise.all([
      window.api.getGlobalDefaults(),
      window.api.checkTmuxInstalled(),
    ]).then(([d, hasTmux]) => {
      setTmuxInstalled(hasTmux);
      setModel(d.model);
      setOpusContext(d.opusContext);
      setSonnetContext(d.sonnetContext);
      setEffort(d.effortLevel);
      setCustomFlags(d.customFlags ?? "");
      setTerminalApp(d.terminalApp ?? "iterm2");
      setTmuxMode(hasTmux ? (d.tmuxMode ?? "cc") : "none");
      setDefaultsDirty(false);
    });
  }, []);

  const handleSaveClaudeMd = async () => {
    await window.api.saveGlobalClaudeMd(claudeMd);
    setClaudeMdDirty(false);
  };

  const handleSaveHooks = async () => {
    try {
      const parsed = JSON.parse(hooksJson);
      await window.api.saveGlobalHooks(parsed);
      setHooksDirty(false);
      setHooksError("");
    } catch {
      setHooksError("Invalid JSON");
    }
  };

  const handleSaveDefaults = async () => {
    await window.api.saveGlobalDefaults({
      model,
      opusContext,
      sonnetContext,
      effortLevel: effort,
      customFlags: customFlags.trim() || undefined,
      terminalApp: terminalApp || undefined,
      tmuxMode: tmuxMode || undefined,
    });
    setDefaultsDirty(false);
  };

  const handleSaveEnv = async () => {
    await window.api.saveGlobalEnv(env);
    setEnvDirty(false);
  };

  const handleAddEnv = () => {
    const key = newKey.trim();
    if (!key) return;
    setEnv((prev) => ({ ...prev, [key]: newValue }));
    setNewKey("");
    setNewValue("");
    setEnvDirty(true);
  };

  const handleRemoveEnv = (key: string) => {
    setEnv((prev) => { const next = { ...prev }; delete next[key]; return next; });
    setEnvDirty(true);
  };

  const handleUpdateEnvValue = (key: string, value: string) => {
    setEnv((prev) => ({ ...prev, [key]: value }));
    setEnvDirty(true);
  };

  const envEntries = Object.entries(env);

  return (
    <div className="manage-global-settings">
      <div className="manage-section">
        <div className="manage-section-header">
          <span className="manage-section-label">Global Config</span>
          <button className="btn-secondary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={async () => { const dir = await window.api.getClaudeHome(); window.api.openInFinder(dir); }}>
            Open in Finder
          </button>
        </div>
      </div>

      <div className="manage-section">
        <div className="manage-section-header">
          <span className="manage-section-label">Global CLAUDE.md</span>
          <div style={{ display: "flex", gap: "6px" }}>
            <button className="insert-prompt-btn" onClick={() => setShowPromptPicker(true)}><svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 2h8a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2"/><path d="M6 5h4M6 8h4M6 11h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>Insert Prompt</button>
            {claudeMdDirty && (
              <button className="btn-primary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={handleSaveClaudeMd}>
                Save
              </button>
            )}
          </div>
        </div>
        {showPromptPicker && (
          <PromptPicker
            onSelect={(content) => { setClaudeMd((prev) => prev ? prev + "\n\n" + content : content); setClaudeMdDirty(true); }}
            onClose={() => setShowPromptPicker(false)}
          />
        )}
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
            <button className="btn-primary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={handleSaveDefaults}>
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
          {model === "opus" && (
            <div className="field">
              <label>Opus Context</label>
              <select value={opusContext ?? "1m"} onChange={(e) => { setOpusContext(e.target.value as "200k" | "1m"); setDefaultsDirty(true); }}>
                <option value="1m">1M (default)</option>
                <option value="200k">200k</option>
              </select>
            </div>
          )}
          {model === "sonnet" && (
            <div className="field">
              <label>Sonnet Context</label>
              <select value={sonnetContext ?? "200k"} onChange={(e) => { setSonnetContext(e.target.value as "200k" | "1m"); setDefaultsDirty(true); }}>
                <option value="200k">200k (default)</option>
                <option value="1m">1M — billed as extra</option>
              </select>
            </div>
          )}
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

      <div className="manage-section">
        <div className="manage-section-header">
          <span className="manage-section-label">Environment Variables</span>
          {envDirty && (
            <button className="btn-primary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={handleSaveEnv}>
              Save
            </button>
          )}
        </div>
        <div className="manage-section-hint">
          From ~/.claude/settings.json — applied to all sessions. Per-profile env vars override these.
        </div>
        <div className="modal-fields" style={{ marginTop: "8px" }}>
          {envEntries.map(([key, value]) => (
            <div className="env-var-row" key={key}>
              <input type="text" value={key} disabled aria-label="Variable name" />
              <input type="text" value={value} onChange={(e) => handleUpdateEnvValue(key, e.target.value)} placeholder="value" aria-label={`${key} value`} />
              <button className="btn-secondary" onClick={() => handleRemoveEnv(key)}>Remove</button>
            </div>
          ))}
          {envEntries.length > 0 && <div className="field-divider" />}
          <div className="env-var-row">
            <input type="text" value={newKey} onChange={(e) => setNewKey(e.target.value.replace(/\s/g, ""))} placeholder="NEW_VAR_NAME" aria-label="New variable name" onKeyDown={(e) => { if (e.key === "Enter") handleAddEnv(); }} />
            <input type="text" value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="value" aria-label="New variable value" onKeyDown={(e) => { if (e.key === "Enter") handleAddEnv(); }} />
            <button className="btn-secondary" onClick={handleAddEnv} disabled={!newKey.trim()}>Add</button>
          </div>
        </div>
      </div>

      <div className="manage-section">
        <div className="manage-section-header">
          <span className="manage-section-label">Default CLI Flags</span>
          {defaultsDirty && (
            <button className="btn-primary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={handleSaveDefaults}>
              Save
            </button>
          )}
        </div>
        <div className="manage-section-hint">
          Flags passed to <code>claude</code> on every launch. Per-profile flags are appended after these.
        </div>
        <div className="modal-fields" style={{ marginTop: "8px" }}>
          <div className="field">
            <input type="text" value={customFlags} onChange={(e) => { setCustomFlags(e.target.value); setDefaultsDirty(true); }} placeholder="e.g. --max-turns 10 --verbose" />
          </div>
        </div>
      </div>

      <div className="manage-section">
        <div className="manage-section-header">
          <span className="manage-section-label">Hooks</span>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            {hooksError && <span style={{ fontSize: "0.846rem", color: "var(--color-danger, #e55)" }}>{hooksError}</span>}
            {hooksDirty && (
              <button className="btn-primary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={handleSaveHooks}>Save</button>
            )}
          </div>
        </div>
        <div className="manage-section-hint">
          Shell commands that run in response to Claude Code events. Saved to ~/.claude/settings.json and inherited by all profiles.
        </div>
        <textarea
          className="manage-claudemd-editor"
          style={{ fontFamily: '"SF Mono", "Fira Code", monospace', fontSize: "0.846rem", minHeight: "140px" }}
          value={hooksJson}
          onChange={(e) => { setHooksJson(e.target.value); setHooksDirty(true); setHooksError(""); }}
          placeholder={'{\n  "PreToolUse": [\n    { "matcher": "*", "hooks": [{ "type": "command", "command": "echo hello" }] }\n  ]\n}'}
        />
      </div>

      <div className="manage-section">
        <div className="manage-section-header">
          <span className="manage-section-label">Launch Defaults</span>
          {defaultsDirty && (
            <button className="btn-primary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={handleSaveDefaults}>
              Save
            </button>
          )}
        </div>
        <div className="manage-section-hint">
          Default terminal and tmux settings used by the launch popover.
        </div>
        <div className="manage-defaults-row">
          <div className="field">
            <label>Terminal App</label>
            <select value={terminalApp} onChange={(e) => { setTerminalApp(e.target.value); setDefaultsDirty(true); }}>
              <option value="iterm2">iTerm2</option>
              <option value="terminal">Terminal.app</option>
            </select>
          </div>
          <div className="field">
            <label>tmux Mode</label>
            {tmuxInstalled ? (
              <select value={tmuxMode} onChange={(e) => { setTmuxMode(e.target.value); setDefaultsDirty(true); }}>
                <option value="cc">-CC (iTerm integration)</option>
                <option value="plain">Plain tmux</option>
                <option value="none">No tmux</option>
              </select>
            ) : (
              <div className="field-hint" style={{ margin: 0 }}>tmux not installed — defaulting to no tmux</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Health tab ─────────────────────────────────────────────────────────────

function HealthTab({ profiles, plugins }: { profiles: Profile[]; plugins: PluginWithItems[] }) {
  const [credStatus, setCredStatus] = useState<{ global: boolean; profiles: Array<{ name: string; useDefaultAuth: boolean; hasCredentials: boolean }> } | null>(null);
  const [profileHealth, setProfileHealth] = useState<Record<string, string[]>>({});
  const [diagnostics, setDiagnostics] = useState<{ version: string; configDir: string; claudeHome: string; profileCount: number; teamCount: number; issues: string[] } | null>(null);
  const [refreshing, setRefreshing] = useState<string | null>(null);
  const [doneFlash, setDoneFlash] = useState<string | null>(null);

  const flashDone = (key: string) => {
    setDoneFlash(key);
    setTimeout(() => setDoneFlash((prev) => prev === key ? null : prev), 2000);
  };

  const refreshCreds = () => {
    setRefreshing("creds");
    window.api.checkCredentialStatus().then((s) => { setCredStatus(s); setRefreshing(null); flashDone("creds"); });
  };

  const refreshDiagnostics = () => {
    setRefreshing("diag");
    window.api.runDiagnostics().then((d) => { setDiagnostics(d); setRefreshing(null); flashDone("diag"); });
  };

  useEffect(() => {
    window.api.checkCredentialStatus().then(setCredStatus);
    window.api.checkProfileHealth().then(setProfileHealth);
    window.api.runDiagnostics().then(setDiagnostics);
  }, []);

  const staleProfiles = useMemo(() => {
    const threshold = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return profiles.filter((p) => p.lastLaunched && p.lastLaunched < threshold);
  }, [profiles]);

  const neverLaunched = useMemo(() => {
    return profiles.filter((p) => !p.lastLaunched);
  }, [profiles]);

  const unusedPlugins = useMemo(() => {
    const usedPlugins = new Set<string>();
    for (const p of profiles) {
      for (const plugin of p.plugins) usedPlugins.add(plugin);
    }
    return plugins.filter((p) => !usedPlugins.has(p.name)).map((p) => p.name);
  }, [profiles, plugins]);

  const healthEntries = Object.entries(profileHealth);
  const totalIssues = (diagnostics?.issues.length ?? 0) + healthEntries.length + staleProfiles.length + unusedPlugins.length;

  return (
    <div className="manage-global-settings">
      <div className="manage-section">
        <div className="manage-section-header">
          <span className="manage-section-label">Credentials</span>
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {doneFlash === "creds" && <span className="health-done-flash">Updated</span>}
            <button className="btn-secondary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={refreshCreds} disabled={refreshing === "creds"}>
              {refreshing === "creds" ? "Refreshing..." : "Refresh"}
            </button>
          </span>
        </div>
        {credStatus ? (
          <div className="modal-fields" style={{ marginTop: "8px" }}>
            <div className="field">
              <label>Global Credentials</label>
              <div className="field-hint" style={{ margin: 0 }}>
                <span style={{ color: credStatus.global ? "var(--color-skill)" : "var(--color-danger)" }}>
                  {credStatus.global ? "Active" : "Not found"}
                </span>
                {" "}— stored in macOS Keychain as "Claude Code-credentials"
              </div>
            </div>
            {credStatus.profiles.length > 0 && (
              <>
                <div className="field-divider" />
                <div className="field">
                  <label>Profile Credentials</label>
                </div>
                {credStatus.profiles.map((p) => (
                  <div className="field" key={p.name}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "0.923rem" }}>
                      <span style={{ color: p.hasCredentials ? "var(--color-skill)" : "var(--text-muted)", fontSize: "0.769rem" }}>
                        {p.hasCredentials ? "\u25CF" : "\u25CB"}
                      </span>
                      <span style={{ color: "var(--text-primary)" }}>{p.name}</span>
                      <span style={{ color: "var(--text-muted)", fontSize: "0.846rem" }}>
                        {p.useDefaultAuth ? "default auth" : "separate auth"}
                      </span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>
        ) : (
          <div className="manage-section-hint">Loading credential status...</div>
        )}
      </div>

      <div className="manage-section">
        <div className="manage-section-header">
          <span className="manage-section-label">Profile Issues</span>
        </div>
        {healthEntries.length > 0 ? (
          <div className="health-issue-list">
            {healthEntries.map(([name, missing]) => (
              <div key={name} className="health-issue-item">
                <span className="health-issue-icon" style={{ color: "var(--color-danger)" }}>{"\u25CF"}</span>
                <span><strong>{name}</strong> — missing plugin{missing.length !== 1 ? "s" : ""}: {missing.join(", ")}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="manage-section-hint">No missing plugins detected.</div>
        )}
        {staleProfiles.length > 0 && (
          <>
            <div className="manage-section-header" style={{ marginTop: "12px" }}>
              <span className="manage-section-label" style={{ fontSize: "0.846rem", color: "var(--text-muted)" }}>Stale Profiles (30+ days)</span>
            </div>
            <div className="health-issue-list">
              {staleProfiles.map((p) => (
                <div key={p.name} className="health-issue-item">
                  <span className="health-issue-icon" style={{ color: "var(--text-muted)" }}>{"\u25CB"}</span>
                  <span>{p.name} — last launched {new Date(p.lastLaunched!).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </>
        )}
        {neverLaunched.length > 0 && (
          <>
            <div className="manage-section-header" style={{ marginTop: "12px" }}>
              <span className="manage-section-label" style={{ fontSize: "0.846rem", color: "var(--text-muted)" }}>Never Launched</span>
            </div>
            <div className="health-issue-list">
              {neverLaunched.map((p) => (
                <div key={p.name} className="health-issue-item">
                  <span className="health-issue-icon" style={{ color: "var(--text-muted)" }}>{"\u25CB"}</span>
                  <span>{p.name}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {unusedPlugins.length > 0 && (
        <div className="manage-section">
          <div className="manage-section-header">
            <span className="manage-section-label">Unused Plugins</span>
          </div>
          <div className="manage-section-hint">
            Installed plugins not used by any profile.
          </div>
          <div className="health-issue-list">
            {unusedPlugins.map((name) => (
              <div key={name} className="health-issue-item">
                <span className="health-issue-icon" style={{ color: "var(--text-muted)" }}>{"\u25CB"}</span>
                <span>{name.split("@")[0]}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="manage-section">
        <div className="manage-section-header">
          <span className="manage-section-label">System Diagnostics</span>
          <span style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {doneFlash === "diag" && <span className="health-done-flash">Updated</span>}
            <button className="btn-secondary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={refreshDiagnostics} disabled={refreshing === "diag"}>
              {refreshing === "diag" ? "Scanning..." : "Re-scan"}
            </button>
          </span>
        </div>
        {diagnostics ? (
          <div className="modal-fields" style={{ marginTop: "8px" }}>
            <div className="field">
              <label>Version</label>
              <div className="field-hint" style={{ margin: 0 }}>{diagnostics.version}</div>
            </div>
            <div className="field">
              <label>Config Dir</label>
              <div className="field-hint" style={{ margin: 0 }}>{diagnostics.configDir}</div>
            </div>
            <div className="field">
              <label>Claude Home</label>
              <div className="field-hint" style={{ margin: 0 }}>{diagnostics.claudeHome}</div>
            </div>
            <div className="field">
              <label>Profiles / Teams</label>
              <div className="field-hint" style={{ margin: 0 }}>{diagnostics.profileCount} profiles, {diagnostics.teamCount} teams</div>
            </div>
            {diagnostics.issues.length > 0 ? (
              <>
                <div className="field-divider" />
                <div className="field">
                  <label>Issues ({diagnostics.issues.length})</label>
                </div>
                {diagnostics.issues.map((issue, i) => (
                  <div key={i} className="health-issue-item">
                    <span className="health-issue-icon" style={{ color: "var(--color-danger)" }}>{"\u25CF"}</span>
                    <span>{issue}</span>
                  </div>
                ))}
              </>
            ) : (
              <>
                <div className="field-divider" />
                <div className="field">
                  <div className="field-hint" style={{ margin: 0, color: "var(--color-skill)" }}>No issues detected.</div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="manage-section-hint">Running diagnostics...</div>
        )}
      </div>
    </div>
  );
}

// ─── Prompts tab ────────────────────────────────────────────────────────────

function PromptsTab() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Prompt | null>(null);
  const [dirty, setDirty] = useState(false);
  const [search, setSearch] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  useEffect(() => {
    window.api.getPrompts().then(setPrompts);
  }, []);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return prompts;
    return prompts.filter((p) =>
      p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [prompts, search]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const p of prompts) for (const t of p.tags) tags.add(t);
    return Array.from(tags).sort();
  }, [prompts]);

  useEffect(() => {
    if (selected) {
      const prompt = prompts.find((p) => p.id === selected);
      if (prompt) {
        setDraft({ ...prompt });
        setDirty(false);
      }
    } else {
      setDraft(null);
      setDirty(false);
    }
  }, [selected, prompts]);

  const handleImport = async () => {
    const imported = await window.api.importPrompt();
    if (!imported) return;
    const next = [...prompts, imported];
    await window.api.savePrompts(next);
    setPrompts(next);
    setSelected(imported.id);
  };

  const handleNew = () => {
    const id = `prompt-${Date.now()}`;
    const now = Date.now();
    const newPrompt: Prompt = { id, name: "", description: "", tags: [], content: "", createdAt: now, updatedAt: now };
    setPrompts((prev) => [...prev, newPrompt]);
    setSelected(id);
    setDraft(newPrompt);
    setDirty(true);
  };

  const handleSave = async () => {
    if (!draft) return;
    const updated = { ...draft, updatedAt: Date.now() };
    const next = prompts.map((p) => p.id === updated.id ? updated : p);
    await window.api.savePrompts(next);
    setPrompts(next);
    setDirty(false);
  };

  const handleDelete = async () => {
    if (!draft) return;
    const next = prompts.filter((p) => p.id !== draft.id);
    await window.api.savePrompts(next);
    setPrompts(next);
    setSelected(null);
  };

  const handleAddTag = () => {
    if (!draft || !tagInput.trim()) return;
    const tag = tagInput.trim();
    if (!draft.tags.includes(tag)) {
      setDraft({ ...draft, tags: [...draft.tags, tag] });
      setDirty(true);
    }
    setTagInput("");
  };

  const handleRemoveTag = (tag: string) => {
    if (!draft) return;
    setDraft({ ...draft, tags: draft.tags.filter((t) => t !== tag) });
    setDirty(true);
  };

  return (
    <div className="manage-dialog-split">
      <div className="manage-dialog-sidebar">
        <div className="manage-projects-header">
          <span className="manage-projects-title">Prompts</span>
          <div style={{ display: "flex", gap: "4px" }}>
            <button className="btn-icon" onClick={handleImport} title="Import prompt" aria-label="Import prompt">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 1v7M3 5l3 3 3-3M2 10h8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button className="btn-icon" onClick={handleNew} title="New prompt" aria-label="New prompt">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M6 1v10M1 6h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        </div>
        <div className="pl-search" style={{ padding: "8px 12px" }}>
          <input
            type="text"
            className="pl-search-input"
            placeholder="Search prompts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="manage-projects-list">
          {filtered.length === 0 ? (
            <div className="manage-projects-empty">
              {prompts.length === 0 ? "No prompts yet. Click + to create one." : "No matches."}
            </div>
          ) : (
            filtered.map((p) => (
              <div
                key={p.id}
                className={`manage-project-item${selected === p.id ? " selected" : ""}`}
                onClick={() => setSelected(p.id)}
              >
                <div className="manage-project-name">{p.name || "Untitled"}</div>
                {p.description && <div className="manage-project-path">{p.description}</div>}
                {p.tags.length > 0 && (
                  <div className="prompt-list-tags">
                    {p.tags.map((t) => <span key={t} className="bulk-tag-chip">{t}</span>)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      <div className="manage-dialog-content">
        {draft ? (
          <div className="manage-project-detail">
            <div className="manage-section">
              <div className="manage-section-header">
                <span className="manage-section-label">Prompt</span>
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  {statusMsg && <span style={{ fontSize: "0.846rem", color: "var(--color-skill)" }}>{statusMsg}</span>}
                  {dirty && (
                    <button className="btn-primary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={handleSave}>Save</button>
                  )}
                  <button className="btn-secondary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={async () => { if (draft) { const p = await window.api.exportPrompt(draft); if (p) { setStatusMsg("Saved to Downloads"); setTimeout(() => setStatusMsg(""), 3000); } } }}>Export</button>
                  <button className="btn-secondary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={handleDelete}>Delete</button>
                </div>
              </div>
              <div className="modal-fields" style={{ marginTop: "8px" }}>
                <div className="field">
                  <label>Name</label>
                  <input type="text" value={draft.name} onChange={(e) => { setDraft({ ...draft, name: e.target.value }); setDirty(true); }} placeholder="Prompt name..." autoFocus />
                </div>
                <div className="field">
                  <label>Description</label>
                  <input type="text" value={draft.description} onChange={(e) => { setDraft({ ...draft, description: e.target.value }); setDirty(true); }} placeholder="What this prompt is for..." />
                </div>
                <div className="field">
                  <label>Tags</label>
                  <div className="prompt-tags-editor">
                    {draft.tags.map((t) => (
                      <span key={t} className="prompt-tag-chip">
                        {t}
                        <button onClick={() => handleRemoveTag(t)}>&times;</button>
                      </span>
                    ))}
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => setTagInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddTag(); }}
                      placeholder="Add tag..."
                      list="prompt-tag-suggestions"
                      className="prompt-tag-input"
                    />
                    <datalist id="prompt-tag-suggestions">
                      {allTags.map((t) => <option key={t} value={t} />)}
                    </datalist>
                  </div>
                </div>
              </div>
            </div>
            <div className="manage-section">
              <div className="manage-section-header">
                <span className="manage-section-label">Content</span>
              </div>
              <textarea
                className="manage-claudemd-editor"
                value={draft.content}
                onChange={(e) => { setDraft({ ...draft, content: e.target.value }); setDirty(true); }}
                placeholder="Prompt content — this text gets inserted into CLAUDE.md editors..."
              />
            </div>
          </div>
        ) : (
          <div className="pm-empty">
            <div className="empty-state">
              <div className="empty-state-icon">&#9998;</div>
              <div className="empty-state-title">Select a prompt</div>
              <div className="empty-state-body">
                Choose a prompt from the list, or create a new one. Prompts can be inserted into profile instructions, project CLAUDE.md, or global CLAUDE.md.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main dialog ────────────────────────────────────────────────────────────

export function ManageDialog({
  plugins,
  profiles,
  availableUpdates,
  hasDefaultProfile,
  initialTab,
  onUpdate,
  onUninstall,
  onNavigateToProfile,
  onCreateDefault,
  onClose,
  onPluginsChanged,
  curatedRefreshKey,
}: Props) {
  const [activeTab, setActiveTab] = useState<ManageTab>(initialTab ?? "plugins");
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Discover view state
  type PluginSubTab = "installed" | "browse" | "sources";
  const [pluginSubTab, setPluginSubTab] = useState<PluginSubTab>("installed");
  const [marketplaces, setMarketplaces] = useState<Array<{ name: string; repo: string; lastUpdated: string }>>([]);

  // Curated marketplace state
  const [curatedData, setCuratedData] = useState<CuratedMarketplaceData | null>(null);
  const [curatedLoading, setCuratedLoading] = useState(false);
  const [curatedError, setCuratedError] = useState<string | null>(null);
  const [curatedCollection, setCuratedCollection] = useState<string | null>(null);
  const [curatedSearch, setCuratedSearch] = useState("");
  const [curatedInstalling, setCuratedInstalling] = useState<string | null>(null);
  const [curatedErrors, setCuratedErrors] = useState<Record<string, string>>({});
  const [curatedDetail, setCuratedDetail] = useState<CuratedDetailTarget | null>(null);

  // A pending destructive action awaiting user confirmation. The ConfirmDialog
  // renders based on this and shows the affected profile count before running.
  type PendingConfirm =
    | { kind: "remove-marketplace"; name: string; displayName?: string }
    | { kind: "uninstall-plugin"; pluginId: string; displayName?: string };
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);

  // Helpers: find profiles that reference a given plugin or any plugin from a marketplace.
  // A profile is "affected" when removing the plugin/marketplace would leave it unhealthy.
  const getProfilesUsingPlugin = (pluginId: string): Profile[] =>
    profiles.filter((p) => p.plugins.includes(pluginId));
  const getProfilesUsingMarketplace = (marketplaceName: string): Profile[] =>
    profiles.filter((p) => p.plugins.some((pid) => pid.endsWith(`@${marketplaceName}`)));
  const [showMarketplacePlugins, setShowMarketplacePlugins] = useState(false);
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [sourcesPluginsLoaded, setSourcesPluginsLoaded] = useState(false);

  const loadCurated = async () => {
    setCuratedLoading(true);
    setCuratedError(null);
    try {
      const data = await window.api.getCuratedMarketplace();
      setCuratedData(data);
    } catch (err: any) {
      setCuratedError(err?.message ?? "Failed to load curated plugins");
    } finally {
      setCuratedLoading(false);
    }
  };

  const refreshCurated = async () => {
    setCuratedLoading(true);
    setCuratedError(null);
    try {
      const [data, idx] = await Promise.all([
        window.api.refreshCuratedMarketplace(),
        window.api.refreshCuratedIndex(),
      ]);
      setCuratedData(data);
      setCuratedIndex(idx);
    } catch (err: any) {
      setCuratedError(err?.message ?? "Failed to refresh curated plugins");
    } finally {
      setCuratedLoading(false);
    }
  };

  // Curated search index — flat, pre-built snapshot of every marketplace,
  // plugin, skill, command, and agent across all curated sources. Enables
  // global in-app search without hitting GitHub per keystroke.
  const [curatedIndex, setCuratedIndex] = useState<CuratedIndex | null>(null);
  const loadCuratedIndex = async () => {
    try {
      const idx = await window.api.getCuratedIndex();
      setCuratedIndex(idx);
    } catch {
      // Silently swallow — search will just fall back to the top-level list.
    }
  };

  // When the top-level hard refresh runs, App.tsx has already invalidated the
  // main-process curated caches. Re-read them here so the local component
  // state picks up the fresh data without waiting for the user to close and
  // reopen the dialog. Only fires when curatedRefreshKey actually changes —
  // the initial 0 value on first mount is a no-op because curatedData /
  // curatedIndex are still null at that point.
  useEffect(() => {
    if (curatedRefreshKey === undefined || curatedRefreshKey === 0) return;
    if (curatedData) loadCurated();
    if (curatedIndex) loadCuratedIndex();
    loadMarketplaces();
  }, [curatedRefreshKey]);

  // Extract `owner/repo` from a GitHub URL (HTTPS or SSH). Used as a fallback
  // when a curated plugin entry has no matching marketplace in marketplaces[].
  function parseOwnerRepoFromUrl(url: string): string | null {
    if (!url) return null;
    const clean = url.replace(/\.git$/, "").replace(/\/$/, "");
    const match = clean.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\/.*)?$/);
    return match ? `${match[1]}/${match[2]}` : null;
  }

  const clearCuratedError = (pluginId: string) => {
    setCuratedErrors((prev) => {
      if (!(pluginId in prev)) return prev;
      const next = { ...prev };
      delete next[pluginId];
      return next;
    });
  };

  const handleCuratedInstall = async (pluginId: string) => {
    setCuratedInstalling(pluginId);
    clearCuratedError(pluginId);
    try {
      const plugin = curatedData?.plugins.find((p) => p.pluginId === pluginId);
      if (!plugin) throw new Error(`Curated plugin not found: ${pluginId}`);

      // Resolve the marketplace source (owner/repo) to pass to
      // `claude plugin marketplace add`. Preference order:
      //   1. If the plugin's `marketplace` field matches a curated CuratedMarketplace.id,
      //      use that entry's `source` — this is the authoritative mapping.
      //   2. Otherwise, parse owner/repo from the plugin's sourceUrl.
      // Either way we fail loud (visible error) if nothing is resolvable.
      let marketplaceSource: string | null = null;
      if (plugin.marketplace && curatedData?.marketplaces) {
        const m = curatedData.marketplaces.find((x) => x.id === plugin.marketplace);
        if (m?.source) marketplaceSource = m.source;
      }
      if (!marketplaceSource) {
        marketplaceSource = parseOwnerRepoFromUrl(plugin.sourceUrl);
      }
      if (!marketplaceSource) {
        throw new Error(
          `Cannot resolve marketplace source for ${pluginId}. Add a matching entry to the curated marketplaces[] array, or make sure sourceUrl is a valid GitHub URL.`
        );
      }

      const currentMarketplaces = await window.api.listMarketplaces();
      const alreadyRegistered = currentMarketplaces.some((m) => m.name === plugin.marketplace);
      if (!alreadyRegistered) {
        await window.api.addMarketplace(marketplaceSource);
      }

      await window.api.installPlugin(pluginId);
      onPluginsChanged?.();
    } catch (err: any) {
      const message = err?.message ?? String(err);
      setCuratedErrors((prev) => ({ ...prev, [pluginId]: message }));
    } finally {
      setCuratedInstalling(null);
    }
  };

  /**
   * Install a plugin whose parent marketplace is already registered. Unlike
   * handleCuratedInstall this skips the curatedData.plugins lookup and the
   * marketplace-source-resolution dance — it accepts any compound
   * `name@marketplace` pluginId and shells straight out to the CLI. Used by
   * the peer-plugin list inside CuratedDetailModal for plugins shipped by an
   * already-added marketplace that aren't in the curated featured set.
   */
  const handlePeerInstall = async (pluginId: string) => {
    setCuratedInstalling(pluginId);
    clearCuratedError(pluginId);
    try {
      await window.api.installPlugin(pluginId);
      onPluginsChanged?.();
    } catch (err: any) {
      const message = err?.message ?? String(err);
      setCuratedErrors((prev) => ({ ...prev, [pluginId]: message }));
    } finally {
      setCuratedInstalling(null);
    }
  };

  /**
   * Resolve an index entry into the concrete install target:
   *   - marketplaceId = the marketplace to register (claude plugin marketplace add)
   *   - pluginId = the plugin to install (claude plugin install <name>@<marketplace>)
   *
   * For skill/command/agent entries we derive the parent plugin from the
   * entry's `path` breadcrumb: path[0] is the marketplace id, path[1] is the
   * plugin name. Clicking Install on a skill installs its parent plugin, which
   * makes the skill available at runtime.
   */
  const resolveIndexInstallTarget = (
    entry: CuratedIndexEntry
  ): { marketplaceId: string | null; pluginId: string | null } => {
    if (entry.kind === "marketplace") {
      return { marketplaceId: entry.id, pluginId: null };
    }
    if (entry.kind === "plugin") {
      // Plugin id is already in `name@marketplace` format; parent marketplace is path[0].
      return { marketplaceId: entry.path[0] ?? null, pluginId: entry.id };
    }
    // skill / command / agent — derive from breadcrumb path
    const marketplaceId = entry.path[0] ?? null;
    const pluginName = entry.path[1] ?? null;
    if (!marketplaceId || !pluginName) return { marketplaceId, pluginId: null };
    return { marketplaceId, pluginId: `${pluginName}@${marketplaceId}` };
  };

  /**
   * Resolve the `owner/repo` source for a curated marketplace id. Prefers the
   * hand-curated `marketplace.json` entry (authoritative). Falls back to
   * parsing `owner/repo` from the index entry's `sourceUrl` if needed.
   */
  const resolveMarketplaceSource = (marketplaceId: string): string | null => {
    const curatedM = curatedData?.marketplaces.find((m) => m.id === marketplaceId);
    if (curatedM?.source) return curatedM.source;
    const indexM = curatedIndex?.entries.find((e) => e.kind === "marketplace" && e.id === marketplaceId);
    if (indexM?.sourceUrl) return parseOwnerRepoFromUrl(indexM.sourceUrl);
    return null;
  };

  /**
   * Install handler for any search-result row. Adds the parent marketplace if
   * not already registered, then installs the plugin that owns the entry.
   * For marketplace entries, only the marketplace is added (no plugin install).
   */
  const handleIndexEntryInstall = async (entry: CuratedIndexEntry) => {
    const { marketplaceId, pluginId } = resolveIndexInstallTarget(entry);
    if (!marketplaceId) return;
    const key = pluginId ?? `mkt:${marketplaceId}`;
    setCuratedInstalling(key);
    clearCuratedError(key);
    try {
      const source = resolveMarketplaceSource(marketplaceId);
      if (!source) {
        throw new Error(`Cannot resolve marketplace source for ${marketplaceId}`);
      }
      const current = await window.api.listMarketplaces();
      if (!current.some((m) => m.name === marketplaceId)) {
        await window.api.addMarketplace(source);
      }
      if (pluginId) {
        await window.api.installPlugin(pluginId);
      }
      await loadMarketplaces();
      onPluginsChanged?.();
    } catch (err: any) {
      const message = err?.message ?? String(err);
      setCuratedErrors((prev) => ({ ...prev, [key]: message }));
    } finally {
      setCuratedInstalling(null);
    }
  };

  const handleCuratedMarketplaceAdd = async (marketplaceId: string) => {
    const key = `mkt:${marketplaceId}`;
    setCuratedInstalling(key);
    clearCuratedError(key);
    try {
      const m = curatedData?.marketplaces.find((x) => x.id === marketplaceId);
      if (!m) throw new Error(`Curated marketplace not found: ${marketplaceId}`);
      const current = await window.api.listMarketplaces();
      if (!current.some((x) => x.name === m.id)) {
        await window.api.addMarketplace(m.source);
      }
      // Refresh the registered-marketplaces list so the row re-renders as "Added".
      await loadMarketplaces();
      onPluginsChanged?.();
    } catch (err: any) {
      const message = err?.message ?? String(err);
      setCuratedErrors((prev) => ({ ...prev, [key]: message }));
    } finally {
      setCuratedInstalling(null);
    }
  };

  /**
   * Open a confirmation dialog before removing a marketplace. The dialog shows
   * how many profiles reference plugins from the marketplace so the user knows
   * which profiles will become unhealthy after removal.
   */
  const requestRemoveMarketplace = (marketplaceName: string, displayName?: string) => {
    setPendingConfirm({ kind: "remove-marketplace", name: marketplaceName, displayName });
  };

  /**
   * Open a confirmation dialog before uninstalling a plugin. Shows affected
   * profiles by exact plugin-id match.
   */
  const requestUninstallPlugin = (pluginId: string, displayName?: string) => {
    setPendingConfirm({ kind: "uninstall-plugin", pluginId, displayName });
  };

  /**
   * Run the pending destructive action. Called from the ConfirmDialog's
   * "Confirm" button. Clears the pending state after completion.
   */
  const handleConfirmedAction = async () => {
    if (!pendingConfirm) return;
    const action = pendingConfirm;
    setPendingConfirm(null);
    try {
      if (action.kind === "remove-marketplace") {
        await window.api.removeMarketplace(action.name);
        await loadMarketplaces();
        onPluginsChanged?.();
      } else if (action.kind === "uninstall-plugin") {
        await onUninstall(action.pluginId);
      }
    } catch (err: any) {
      // Surface via the existing marketplace-error or curated-error channels.
      // For now just log — we don't have a toast system and the user will see
      // the result in the list (or lack thereof) on the next refresh.
      console.error("Destructive action failed:", err?.message ?? err);
    }
  };

  // Build a lookup set so row renders can check "is this marketplace registered?" in O(1).
  const registeredMarketplaceNames = useMemo(() => new Set(marketplaces.map((m) => m.name)), [marketplaces]);

  // Unify marketplaces + plugins into a single list of CuratedDetailTarget entries
  // so the UI can render them together. Each entry carries its kind so the row
  // render can branch on marketplace vs plugin behaviour.
  const allCuratedEntries = useMemo((): CuratedDetailTarget[] => {
    if (!curatedData) return [];
    const marketplaces: CuratedDetailTarget[] = curatedData.marketplaces.map((m) => ({ kind: "marketplace", entry: m }));
    const plugins: CuratedDetailTarget[] = curatedData.plugins.map((p) => ({ kind: "plugin", entry: p }));
    return [...marketplaces, ...plugins];
  }, [curatedData]);

  const filteredCurated = useMemo(() => {
    let result = allCuratedEntries;
    if (curatedCollection) {
      result = result.filter((t) => t.entry.collections.includes(curatedCollection));
    }
    const q = curatedSearch.toLowerCase().trim();
    if (q) {
      result = result.filter((t) => {
        const name = t.entry.displayName.toLowerCase();
        const desc = t.entry.description.toLowerCase();
        const idOrPid = t.kind === "marketplace" ? t.entry.id.toLowerCase() : t.entry.pluginId.toLowerCase();
        return name.includes(q) || desc.includes(q) || idOrPid.includes(q);
      });
    }
    return result;
  }, [allCuratedEntries, curatedCollection, curatedSearch]);

  const featuredCurated = useMemo(() => {
    return allCuratedEntries.filter((t) => t.entry.featured);
  }, [allCuratedEntries]);

  // Global search across the full pre-built index (marketplaces + plugins +
  // skills + commands + agents). Tokenised with word-boundary awareness:
  //
  //   - Split the query by whitespace into tokens.
  //   - Every token must match somewhere in the haystack (AND match).
  //   - A "finished" token (followed by a space, or any token that isn't the
  //     last one) requires a word-boundary match — so "ui " or "ui design"
  //     won't match "build" or "guidance".
  //   - The last token, if there's no trailing space, is treated as a substring
  //     match so typing "eng" still matches "engineering" while the user is
  //     still composing the word.
  //
  // Groups results by kind in a stable order for the UI.
  const indexSearchResults = useMemo(() => {
    const raw = curatedSearch;
    if (!raw.trim()) return null;

    const hasTrailingSpace = /\s$/.test(raw);
    const parts = raw.toLowerCase().trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return null;

    const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const tokens = parts.map((text, i) => {
      const isLast = i === parts.length - 1;
      const finished = !isLast || hasTrailingSpace;
      return {
        text,
        finished,
        regex: finished ? new RegExp(`(^|\\W)${escapeRegex(text)}(\\W|$)`) : null,
      };
    });

    // Build the searchable haystack as a combination of:
    //   1. The pre-built curated index (all kinds: marketplace/plugin/skill/command/agent)
    //   2. The live curated marketplace.json data (top-level marketplaces + plugins only)
    //
    // (2) is important because marketplace.json is fresh on every load, whereas
    // index.json is only regenerated when the curator runs build-index.js. Any
    // marketplaces or plugins added to marketplace.json since the last index
    // rebuild would otherwise be invisible to search. Dedupe by "kind:id" so
    // entries present in both sources only appear once.
    const combined: CuratedIndexEntry[] = [];
    const seen = new Set<string>();

    if (curatedIndex) {
      for (const e of curatedIndex.entries) {
        const key = `${e.kind}:${e.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        combined.push(e);
      }
    }

    if (curatedData) {
      for (const m of curatedData.marketplaces) {
        const key = `marketplace:${m.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        combined.push({
          kind: "marketplace",
          id: m.id,
          displayName: m.displayName,
          description: m.description,
          sourceUrl: m.sourceUrl,
          path: [],
          collections: m.collections,
          featured: m.featured,
        });
      }
      for (const p of curatedData.plugins) {
        const key = `plugin:${p.pluginId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        combined.push({
          kind: "plugin",
          id: p.pluginId,
          displayName: p.displayName,
          description: p.description,
          sourceUrl: p.sourceUrl,
          path: p.marketplace ? [p.marketplace] : [],
          collections: p.collections,
          featured: p.featured,
        });
      }
    }

    if (combined.length === 0) return null;

    const matches: CuratedIndexEntry[] = [];
    for (const e of combined) {
      const haystack =
        (
          e.displayName + " " + e.description + " " + e.id + " " + e.path.join(" ")
        ).toLowerCase();

      const allTokensMatch = tokens.every((t) =>
        t.finished && t.regex ? t.regex.test(haystack) : haystack.includes(t.text)
      );
      if (allTokensMatch) matches.push(e);
    }

    const order: CuratedIndexEntry["kind"][] = ["marketplace", "plugin", "skill", "command", "agent", "mcpServer"];
    const grouped: Array<{ kind: CuratedIndexEntry["kind"]; entries: CuratedIndexEntry[] }> = [];
    for (const k of order) {
      const entries = matches.filter((e) => e.kind === k);
      if (entries.length > 0) grouped.push({ kind: k, entries });
    }
    return { grouped, total: matches.length };
  }, [curatedSearch, curatedIndex, curatedData]);
  const [marketplaceInput, setMarketplaceInput] = useState("");
  const [marketplaceLoading, setMarketplaceLoading] = useState(false);
  const [marketplaceError, setMarketplaceError] = useState<string | null>(null);

  const loadMarketplaces = async () => {
    const list = await window.api.listMarketplaces();
    setMarketplaces(list);
  };

  const handleAddMarketplace = async () => {
    const source = marketplaceInput.trim();
    if (!source) return;
    setMarketplaceLoading(true);
    setMarketplaceError(null);
    try {
      await window.api.addMarketplace(source);
      setMarketplaceInput("");
      await loadMarketplaces();
      onPluginsChanged?.();
    } catch (err: any) {
      setMarketplaceError(err?.message ?? "Failed to add marketplace");
    } finally {
      setMarketplaceLoading(false);
    }
  };

  const handleRemoveMarketplace = async (name: string) => {
    setMarketplaceLoading(true);
    try {
      await window.api.removeMarketplace(name);
      await loadMarketplaces();
      onPluginsChanged?.();
    } catch (err: any) {
      setMarketplaceError(err?.message ?? "Failed to remove marketplace");
    } finally {
      setMarketplaceLoading(false);
    }
  };
  const [availablePlugins, setAvailablePlugins] = useState<AvailablePlugin[]>([]);
  const installedPluginIds = useMemo(() => new Set(plugins.map((p) => p.name)), [plugins]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [discoverLoaded, setDiscoverLoaded] = useState(false);
  const [discoverError, setDiscoverError] = useState<string | null>(null);
  const [selectedDiscoverPlugin, setSelectedDiscoverPlugin] = useState<string | null>(null);

  const loadAvailablePlugins = async () => {
    setDiscoverLoading(true);
    setDiscoverError(null);
    try {
      const data = await window.api.getAvailablePlugins();
      setAvailablePlugins(data.available);
      setDiscoverLoaded(true);
    } catch (err: any) {
      setDiscoverError(err?.message ?? "Failed to load available plugins");
    } finally {
      setDiscoverLoading(false);
    }
  };

  const handleInstallPlugin = async (pluginId: string) => {
    await window.api.installPlugin(pluginId);
    onPluginsChanged?.();
  };

  const [manualInstallInput, setManualInstallInput] = useState("");
  const [manualInstallLoading, setManualInstallLoading] = useState(false);
  const [manualInstallError, setManualInstallError] = useState<string | null>(null);

  const handleManualInstall = async () => {
    const id = manualInstallInput.trim();
    if (!id) return;
    setManualInstallLoading(true);
    setManualInstallError(null);
    try {
      await window.api.installPlugin(id);
      setManualInstallInput("");
      onPluginsChanged?.();
    } catch (err: any) {
      setManualInstallError(err?.message ?? "Failed to install plugin");
    } finally {
      setManualInstallLoading(false);
    }
  };

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
    <>
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
              className={`manage-dialog-tab${activeTab === "prompts" ? " active" : ""}`}
              onClick={() => setActiveTab("prompts")}
            >
              Prompts
            </button>
            <button
              className={`manage-dialog-tab${activeTab === "global" ? " active" : ""}`}
              onClick={() => setActiveTab("global")}
            >
              Global
            </button>
            <button
              className={`manage-dialog-tab${activeTab === "health" ? " active" : ""}`}
              onClick={() => setActiveTab("health")}
            >
              Health
            </button>
            <button
              className={`manage-dialog-tab${activeTab === "statusbar" ? " active" : ""}`}
              onClick={() => setActiveTab("statusbar")}
            >
              Status Bar
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
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <div className="discover-toggle">
                <button
                  className={`discover-toggle-btn${pluginSubTab === "installed" ? " active" : ""}`}
                  onClick={() => setPluginSubTab("installed")}
                >
                  Installed
                </button>
                <button
                  className={`discover-toggle-btn${pluginSubTab === "browse" ? " active" : ""}`}
                  onClick={() => {
                    setPluginSubTab("browse");
                    if (!curatedData && !curatedLoading) loadCurated();
                    if (!curatedIndex) loadCuratedIndex();
                    // Also load the registered-marketplaces list so the Browse tab
                    // can mark curated marketplaces as "Added" when already registered.
                    loadMarketplaces();
                  }}
                >
                  Browse
                </button>
                <button
                  className={`discover-toggle-btn${pluginSubTab === "sources" ? " active" : ""}`}
                  onClick={() => {
                    setPluginSubTab("sources");
                    loadMarketplaces();
                  }}
                >
                  Sources
                </button>
              </div>
              {pluginSubTab === "installed" ? (
                <>
                  {!hasDefaultProfile && (
                    <div className="manage-default-nudge">
                      <div className="manage-default-nudge-text">
                        <strong>No default profile.</strong> Running <code>claude</code> loads all {plugins.length} installed plugin{plugins.length !== 1 ? "s" : ""}.
                      </div>
                      <button className="btn-primary" onClick={onCreateDefault}>
                        Create Default Profile
                      </button>
                    </div>
                  )}
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
                </>
              ) : pluginSubTab === "browse" ? (
                <div className="curated-tab">
                  {curatedLoading ? (
                    <div className="discover-loading">Loading curated plugins...</div>
                  ) : curatedError ? (
                    <div className="discover-error">
                      <span>{curatedError}</span>
                      <button className="btn-secondary" onClick={loadCurated}>Retry</button>
                    </div>
                  ) : curatedData ? (
                    <>
                      {/* Featured row */}
                      {featuredCurated.length > 0 && (
                        <div className="curated-featured">
                          <div className="curated-section-title">Featured</div>
                          <div className="curated-featured-row">
                            {featuredCurated.map((t) => {
                              const key = t.kind === "marketplace" ? `mkt:${t.entry.id}` : t.entry.pluginId;
                              const isInstalled = t.kind === "plugin" && installedPluginIds.has(t.entry.pluginId);
                              const isInstalling = curatedInstalling === key;
                              return (
                                <div
                                  key={key}
                                  className="curated-featured-card clickable"
                                  onClick={() => setCuratedDetail(t)}
                                  role="button"
                                  tabIndex={0}
                                >
                                  <div className="curated-featured-card-header">
                                    <span className="curated-featured-name">{t.entry.displayName}</span>
                                    <span className="curated-kind-tag">
                                      {t.kind === "marketplace"
                                        ? `marketplace · ${t.entry.pluginCount} plugins`
                                        : "plugin"}
                                    </span>
                                    {t.entry.collections.includes("bundle") && (
                                      <span className="curated-bundle-badge">Bundle</span>
                                    )}
                                  </div>
                                  <div className="curated-featured-desc">{t.entry.description}</div>
                                  <div className="curated-featured-footer">
                                    <div className="curated-collection-tags">
                                      {t.entry.collections.slice(0, 2).map((c) => {
                                        const col = curatedData.collections.find((x) => x.id === c);
                                        return col ? (
                                          <span key={c} className="curated-tag">
                                            <CollectionIcon name={col.icon} />
                                            <span>{col.name}</span>
                                          </span>
                                        ) : null;
                                      })}
                                    </div>
                                    {t.kind === "marketplace" ? (
                                      registeredMarketplaceNames.has(t.entry.id) ? (
                                        <div className="curated-added-group">
                                          <span className="curated-installed-label">Added</span>
                                          <button
                                            className="btn-danger-small"
                                            onClick={(e) => { e.stopPropagation(); requestRemoveMarketplace(t.entry.id, t.entry.displayName); }}
                                            title="Remove marketplace"
                                          >
                                            Remove
                                          </button>
                                        </div>
                                      ) : (
                                        <button
                                          className="btn-primary curated-install-btn"
                                          onClick={(e) => { e.stopPropagation(); handleCuratedMarketplaceAdd(t.entry.id); }}
                                          disabled={isInstalling}
                                        >
                                          {isInstalling ? "..." : "Add"}
                                        </button>
                                      )
                                    ) : isInstalled ? (
                                      <span className="curated-installed-label">Installed</span>
                                    ) : (
                                      <button
                                        className="btn-primary curated-install-btn"
                                        onClick={(e) => { e.stopPropagation(); handleCuratedInstall(t.entry.pluginId); }}
                                        disabled={isInstalling}
                                      >
                                        {isInstalling ? "..." : "Install"}
                                      </button>
                                    )}
                                  </div>
                                  {curatedErrors[key] && (
                                    <div className="curated-install-error">{curatedErrors[key]}</div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Collections filter */}
                      {curatedData.collections.length > 0 && (
                        <div className="curated-collections">
                          <div className="curated-section-title">Collections</div>
                          <div className="curated-collection-row">
                            <button
                              className={`curated-collection-chip${curatedCollection === null ? " active" : ""}`}
                              onClick={() => setCuratedCollection(null)}
                            >
                              All
                            </button>
                            {curatedData.collections.map((c) => (
                              <button
                                key={c.id}
                                className={`curated-collection-chip${curatedCollection === c.id ? " active" : ""}`}
                                onClick={() => setCuratedCollection(curatedCollection === c.id ? null : c.id)}
                                title={c.description}
                              >
                                <CollectionIcon name={c.icon} />
                                <span>{c.name}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Search + refresh */}
                      <div className="curated-toolbar">
                        <input
                          type="text"
                          className="curated-search"
                          placeholder="Search"
                          value={curatedSearch}
                          onChange={(e) => setCuratedSearch(e.target.value)}
                        />
                        <button
                          className="btn-secondary curated-refresh-btn"
                          onClick={refreshCurated}
                          disabled={curatedLoading}
                          title="Refresh curated list"
                        >
                          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                            <path d="M14 8A6 6 0 1 1 8 2c1.66 0 3.14.69 4.22 1.78L14 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                            <path d="M14 2v4h-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                      </div>

                      {/* Entry list — shows top-level curated entries normally,
                          swaps to a grouped global search view when the user types. */}
                      {indexSearchResults ? (
                        <div className="curated-list curated-search-list">
                          {indexSearchResults.total === 0 ? (
                            <div className="empty-state-inline" style={{ padding: "20px" }}>
                              No results for "{curatedSearch}" across {curatedIndex?.entries.length ?? 0} entries
                            </div>
                          ) : (
                            <>
                              <div className="curated-search-summary">
                                {indexSearchResults.total} match{indexSearchResults.total !== 1 ? "es" : ""} across {indexSearchResults.grouped.length} kind{indexSearchResults.grouped.length !== 1 ? "s" : ""}
                              </div>
                              {indexSearchResults.grouped.map((group) => (
                                <div key={group.kind} className="curated-search-group">
                                  <div className="curated-search-group-title">
                                    {group.kind}{group.entries.length !== 1 ? "s" : ""}
                                    <span className="curated-search-group-count">{group.entries.length}</span>
                                  </div>
                                  {group.entries.map((e) => {
                                    const breadcrumb = e.path.length > 0 ? e.path.join(" › ") : null;
                                    const target = resolveIndexInstallTarget(e);
                                    const installKey = target.pluginId ?? (target.marketplaceId ? `mkt:${target.marketplaceId}` : `idx:${e.id}`);
                                    const isInstalling = curatedInstalling === installKey;
                                    const isPluginInstalled = target.pluginId ? installedPluginIds.has(target.pluginId) : false;
                                    const isMarketplaceAdded = e.kind === "marketplace" && registeredMarketplaceNames.has(e.id);
                                    // For skill/command/agent/mcpServer entries, "installed" means their parent plugin is installed.
                                    const isParentInstalled = (e.kind === "skill" || e.kind === "command" || e.kind === "agent" || e.kind === "mcpServer")
                                      ? isPluginInstalled
                                      : false;

                                    const handleResultClick = () => {
                                      if (e.kind === "marketplace") {
                                        const m = curatedData?.marketplaces.find((x) => x.id === e.id);
                                        if (m) { setCuratedDetail({ kind: "marketplace", entry: m }); return; }
                                      } else if (e.kind === "plugin") {
                                        const p = curatedData?.plugins.find((x) => x.pluginId === e.id);
                                        if (p) { setCuratedDetail({ kind: "plugin", entry: p }); return; }
                                      }
                                      if (e.sourceUrl) window.api.openExternalUrl(e.sourceUrl);
                                    };

                                    // Action button label and tooltip vary by kind.
                                    let actionLabel = "Install";
                                    let actionTitle = "";
                                    if (e.kind === "marketplace") {
                                      actionLabel = "Add";
                                      actionTitle = `Add marketplace ${e.displayName}`;
                                    } else if (e.kind === "plugin") {
                                      actionLabel = "Install";
                                      actionTitle = `Install plugin ${e.displayName} from ${target.marketplaceId ?? "marketplace"}`;
                                    } else {
                                      const pluginName = e.path[1] ?? "plugin";
                                      actionLabel = "Install";
                                      actionTitle = `Installs ${pluginName} from ${target.marketplaceId ?? "marketplace"} (provides this ${e.kind})`;
                                    }

                                    const renderAction = () => {
                                      if (isPluginInstalled || isParentInstalled) {
                                        return <span className="curated-installed-label">Installed</span>;
                                      }
                                      if (isMarketplaceAdded) {
                                        return <span className="curated-installed-label">Added</span>;
                                      }
                                      if (!target.marketplaceId) return null;
                                      return (
                                        <button
                                          className="btn-primary curated-install-btn"
                                          onClick={(ev) => { ev.stopPropagation(); handleIndexEntryInstall(e); }}
                                          disabled={isInstalling}
                                          title={actionTitle}
                                        >
                                          {isInstalling ? "..." : actionLabel}
                                        </button>
                                      );
                                    };

                                    return (
                                      <div
                                        key={e.id}
                                        className="curated-search-result clickable"
                                        onClick={handleResultClick}
                                        role="button"
                                        tabIndex={0}
                                      >
                                        <div className="curated-search-result-content">
                                          <div className="curated-search-result-header">
                                            <span className={`curated-kind-tag kind-${e.kind}`}>{e.kind}</span>
                                            {e.kind === "mcpServer" && e.transport && (
                                              <span className="curated-transport-chip">{e.transport}</span>
                                            )}
                                            <span className="curated-search-result-name">{e.displayName}</span>
                                          </div>
                                          {e.description && (
                                            <div className="curated-search-result-desc">{e.description}</div>
                                          )}
                                          {breadcrumb && (
                                            <div className="curated-search-result-path">{breadcrumb}</div>
                                          )}
                                          {curatedErrors[installKey] && (
                                            <div className="curated-install-error">{curatedErrors[installKey]}</div>
                                          )}
                                        </div>
                                        <div className="curated-search-result-action" onClick={(ev) => ev.stopPropagation()}>
                                          {renderAction()}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ))}
                            </>
                          )}
                        </div>
                      ) : (
                      <div className="curated-list">
                        {filteredCurated.length === 0 ? (
                          <div className="empty-state-inline" style={{ padding: "20px" }}>
                            {curatedSearch || curatedCollection ? "No matching entries" : "No curated marketplaces or plugins available"}
                          </div>
                        ) : (
                          filteredCurated.map((t) => {
                            const key = t.kind === "marketplace" ? `mkt:${t.entry.id}` : t.entry.pluginId;
                            const isInstalled = t.kind === "plugin" && installedPluginIds.has(t.entry.pluginId);
                            const isInstalling = curatedInstalling === key;
                            const sourceLabel = t.kind === "marketplace"
                              ? `marketplace · ${t.entry.pluginCount} plugins`
                              : t.entry.marketplace;
                            return (
                              <div
                                key={key}
                                className="curated-plugin-row clickable"
                                onClick={() => setCuratedDetail(t)}
                                role="button"
                                tabIndex={0}
                              >
                                <div className="curated-plugin-info">
                                  <div className="curated-plugin-name-row">
                                    <span className="curated-plugin-name">{t.entry.displayName}</span>
                                    <span className="curated-kind-tag">
                                      {t.kind === "marketplace" ? "marketplace" : "plugin"}
                                    </span>
                                    {t.entry.collections.includes("bundle") && (
                                      <span className="curated-bundle-badge">Bundle</span>
                                    )}
                                  </div>
                                  <div className="curated-plugin-desc">{t.entry.description}</div>
                                  <div className="curated-plugin-meta">
                                    <span className="curated-plugin-source">{sourceLabel}</span>
                                    {t.entry.collections.map((c) => {
                                      const col = curatedData.collections.find((x) => x.id === c);
                                      return col ? (
                                        <span
                                          key={c}
                                          className={`curated-tag clickable${curatedCollection === c ? " active" : ""}`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setCuratedCollection(curatedCollection === c ? null : c);
                                          }}
                                        >
                                          <CollectionIcon name={col.icon} />
                                          <span>{col.name}</span>
                                        </span>
                                      ) : null;
                                    })}
                                  </div>
                                </div>
                                <div className="curated-plugin-action" onClick={(e) => e.stopPropagation()}>
                                  {t.kind === "marketplace" ? (
                                    registeredMarketplaceNames.has(t.entry.id) ? (
                                      <div className="curated-added-group">
                                        <span className="curated-installed-label">Added</span>
                                        <button
                                          className="btn-danger-small"
                                          onClick={() => requestRemoveMarketplace(t.entry.id, t.entry.displayName)}
                                          title="Remove marketplace"
                                        >
                                          Remove
                                        </button>
                                      </div>
                                    ) : (
                                      <button
                                        className="btn-primary curated-install-btn"
                                        onClick={() => handleCuratedMarketplaceAdd(t.entry.id)}
                                        disabled={isInstalling}
                                      >
                                        {isInstalling ? "Adding..." : "Add"}
                                      </button>
                                    )
                                  ) : isInstalled ? (
                                    <span className="curated-installed-label">Installed</span>
                                  ) : (
                                    <button
                                      className="btn-primary curated-install-btn"
                                      onClick={() => handleCuratedInstall(t.entry.pluginId)}
                                      disabled={isInstalling}
                                    >
                                      {isInstalling ? "Installing..." : "Install"}
                                    </button>
                                  )}
                                  {curatedErrors[key] && (
                                    <div className="curated-install-error">{curatedErrors[key]}</div>
                                  )}
                                </div>
                              </div>
                            );
                          })
                        )}
                      </div>
                      )}
                    </>
                  ) : null}

                  {/* Collapsible: plugins from installed marketplaces */}
                  <div className="browse-marketplace-toggle" onClick={() => {
                    setShowMarketplacePlugins(!showMarketplacePlugins);
                    if (!showMarketplacePlugins && !discoverLoaded && !discoverLoading) loadAvailablePlugins();
                  }}>
                    <span className={`browse-marketplace-arrow${showMarketplacePlugins ? " open" : ""}`}>&#9654;</span>
                    <span className="browse-marketplace-label">
                      Plugins available from installed marketplaces
                      {availablePlugins.length > 0 && ` (${availablePlugins.length})`}
                    </span>
                  </div>
                  {showMarketplacePlugins && (
                    <div className="browse-marketplace-content">
                      {discoverLoading ? (
                        <div className="discover-loading">Loading available plugins...</div>
                      ) : discoverError ? (
                        <div className="discover-error">
                          <span>{discoverError}</span>
                          <button className="btn-secondary" onClick={loadAvailablePlugins}>Retry</button>
                        </div>
                      ) : (
                        <div className="manage-dialog-split">
                          <div className="manage-dialog-sidebar">
                            <DiscoverList
                              plugins={availablePlugins}
                              installedIds={installedPluginIds}
                              selectedId={selectedDiscoverPlugin}
                              onSelect={setSelectedDiscoverPlugin}
                            />
                          </div>
                          <div className="manage-dialog-content">
                            <DiscoverDetail
                              key={selectedDiscoverPlugin ?? "none"}
                              plugin={availablePlugins.find((p) => p.pluginId === selectedDiscoverPlugin) ?? null}
                              isInstalled={selectedDiscoverPlugin ? installedPluginIds.has(selectedDiscoverPlugin) : false}
                              onInstall={handleInstallPlugin}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="marketplace-tab">
                  <div className="marketplace-add-row">
                    <input
                      type="text"
                      className="marketplace-input"
                      placeholder="GitHub repo (e.g. owner/repo)"
                      value={marketplaceInput}
                      onChange={(e) => setMarketplaceInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleAddMarketplace(); }}
                      disabled={marketplaceLoading}
                    />
                    <button
                      className="btn-primary"
                      onClick={handleAddMarketplace}
                      disabled={!marketplaceInput.trim() || marketplaceLoading}
                    >
                      {marketplaceLoading ? "Adding..." : "Add"}
                    </button>
                  </div>
                  {marketplaceError && (
                    <div className="marketplace-error">{marketplaceError}</div>
                  )}
                  <div className="marketplace-list">
                    {marketplaces.length === 0 ? (
                      <div className="empty-state-inline">No marketplace sources registered</div>
                    ) : (
                      marketplaces.map((mp) => {
                        const isExpanded = expandedSources.has(mp.name);
                        const sourcePlugins = availablePlugins.filter((p) => p.marketplaceName === mp.name);
                        return (
                          <div key={mp.name} className="marketplace-source-group">
                            <div className="marketplace-item">
                              <div
                                className="marketplace-item-body"
                                style={{ cursor: "pointer" }}
                                onClick={() => {
                                  const next = new Set(expandedSources);
                                  if (isExpanded) next.delete(mp.name); else next.add(mp.name);
                                  setExpandedSources(next);
                                  if (!sourcesPluginsLoaded && !discoverLoading) {
                                    loadAvailablePlugins();
                                    setSourcesPluginsLoaded(true);
                                  }
                                }}
                              >
                                <div className="marketplace-item-name">
                                  <span className={`browse-marketplace-arrow${isExpanded ? " open" : ""}`}>&#9654;</span>
                                  {" "}{mp.name}
                                </div>
                                <div className="marketplace-item-repo">{mp.repo}</div>
                              </div>
                              {mp.name !== "claude-plugins-official" && (
                                <button
                                  className="btn-danger-small"
                                  onClick={(e) => { e.stopPropagation(); requestRemoveMarketplace(mp.name); }}
                                  disabled={marketplaceLoading}
                                  title="Remove source"
                                >
                                  Remove
                                </button>
                              )}
                            </div>
                            {isExpanded && (() => {
                              const installedFromSource = plugins.filter((p) => p.marketplace === mp.name);
                              const installedNames = new Set(installedFromSource.map((p) => p.name));
                              const allFromSource = [
                                ...installedFromSource.map((p) => ({
                                  id: p.name,
                                  displayName: p.pluginName,
                                  description: "",
                                  installed: true,
                                })),
                                ...sourcePlugins
                                  .filter((sp) => !installedNames.has(sp.pluginId))
                                  .map((sp) => ({
                                    id: sp.pluginId,
                                    displayName: sp.name,
                                    description: sp.description,
                                    installed: false,
                                  })),
                              ];
                              return (
                                <div className="source-plugins-list">
                                  {discoverLoading ? (
                                    <div className="discover-loading" style={{ padding: "8px 12px" }}>Loading plugins...</div>
                                  ) : allFromSource.length === 0 ? (
                                    <div className="empty-state-inline" style={{ padding: "8px 12px" }}>No plugins from this source</div>
                                  ) : (
                                    allFromSource.map((sp) => (
                                      <div key={sp.id} className="source-plugin-row">
                                        <div className="source-plugin-info">
                                          <span className="source-plugin-name">{sp.displayName}</span>
                                          {sp.description && <span className="source-plugin-desc">{sp.description}</span>}
                                        </div>
                                        {sp.installed ? (
                                          <button
                                            className="btn-danger-small"
                                            onClick={() => requestUninstallPlugin(sp.id, sp.displayName)}
                                            title="Uninstall"
                                          >
                                            Uninstall
                                          </button>
                                        ) : (
                                          <button
                                            className="btn-primary curated-install-btn"
                                            onClick={() => handleInstallPlugin(sp.id)}
                                          >
                                            Install
                                          </button>
                                        )}
                                      </div>
                                    ))
                                  )}
                                </div>
                              );
                            })()}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {activeTab === "projects" && <ProjectsTab />}

          {activeTab === "prompts" && <PromptsTab />}

          {activeTab === "global" && <GlobalSettingsTab />}
          {activeTab === "health" && <HealthTab profiles={profiles} plugins={plugins} />}
          {activeTab === "statusbar" && <StatusBarTab />}
        </div>
      </div>
    </div>
    {curatedDetail && (
      <CuratedDetailModal
        target={curatedDetail}
        installedPluginIds={installedPluginIds}
        registeredMarketplaceIds={registeredMarketplaceNames}
        onClose={() => setCuratedDetail(null)}
        onInstallPlugin={(pid) => handleCuratedInstall(pid)}
        onAddMarketplace={(mid) => handleCuratedMarketplaceAdd(mid)}
        onInstallPeerPlugin={(pid) => handlePeerInstall(pid)}
        onUninstallPlugin={(pid, name) => requestUninstallPlugin(pid, name)}
        curatedInstalling={curatedInstalling}
        curatedErrors={curatedErrors}
      />
    )}
    {pendingConfirm && (() => {
      const affected = pendingConfirm.kind === "remove-marketplace"
        ? getProfilesUsingMarketplace(pendingConfirm.name)
        : getProfilesUsingPlugin(pendingConfirm.pluginId);
      const label = pendingConfirm.displayName ?? (pendingConfirm.kind === "remove-marketplace" ? pendingConfirm.name : pendingConfirm.pluginId);
      const thingType = pendingConfirm.kind === "remove-marketplace" ? "marketplace" : "plugin";
      const verb = pendingConfirm.kind === "remove-marketplace" ? "Remove" : "Uninstall";
      const title = `${verb} ${thingType} "${label}"?`;
      const description = affected.length > 0 ? (
        <>
          This {thingType} is used by <strong>{affected.length}</strong> profile{affected.length !== 1 ? "s" : ""}
          : {affected.map((p) => p.name).join(", ")}.
          <br />
          {affected.length === 1 ? "It" : "They"} will show as unhealthy after {verb.toLowerCase()}.
        </>
      ) : (
        `This ${thingType} is not used by any profiles.`
      );
      return (
        <ConfirmDialog
          title={title}
          description={description}
          confirmLabel={verb}
          confirmVariant="danger"
          onConfirm={handleConfirmedAction}
          onCancel={() => setPendingConfirm(null)}
        />
      );
    })()}
    </>
  );
}
