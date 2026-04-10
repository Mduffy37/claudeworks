import React, { useState, useEffect, useRef, useMemo } from "react";
import { PluginList } from "./PluginList";
import { PluginManager } from "./PluginManager";
import { DiscoverList } from "./DiscoverList";
import { DiscoverDetail } from "./DiscoverDetail";
import type { PluginWithItems, Profile, Prompt, AvailablePlugin } from "../../electron/types";
import { PromptPicker } from "./PromptPicker";

type ManageTab = "plugins" | "projects" | "global" | "prompts";

interface Props {
  plugins: PluginWithItems[];
  profiles: Profile[];
  availableUpdates: Record<string, string>;
  hasDefaultProfile: boolean;
  onUpdate: (name: string) => Promise<void>;
  onUninstall: (name: string) => Promise<void>;
  onNavigateToProfile: (profileName: string) => void;
  onCreateDefault: () => void;
  onClose: () => void;
  onPluginsChanged?: () => void;
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
                  <div className="field" key={key}>
                    <label>{key}</label>
                    <div className="field-with-button">
                      <input type="text" value={value as string} onChange={(e) => { setProjSettings((p) => ({ ...p, env: { ...(p.env ?? {}), [key]: e.target.value } })); setSettingsDirty(true); }} />
                      <button className="btn-secondary" onClick={() => { setProjSettings((p) => { const env = { ...(p.env ?? {}) }; delete env[key]; return { ...p, env: Object.keys(env).length > 0 ? env : undefined }; }); setSettingsDirty(true); }}>Remove</button>
                    </div>
                  </div>
                ))}
                {projEnvEntries.length > 0 && <div className="field-divider" />}
                <div className="field">
                  <label>Add Variable</label>
                  <div className="field-with-button">
                    <input type="text" value={projEnvNewKey} onChange={(e) => setProjEnvNewKey(e.target.value.replace(/\s/g, ""))} placeholder="KEY" onKeyDown={(e) => { if (e.key === "Enter" && projEnvNewKey.trim()) { setProjSettings((p) => ({ ...p, env: { ...(p.env ?? {}), [projEnvNewKey.trim()]: projEnvNewVal } })); setProjEnvNewKey(""); setProjEnvNewVal(""); setSettingsDirty(true); } }} />
                    <input type="text" value={projEnvNewVal} onChange={(e) => setProjEnvNewVal(e.target.value)} placeholder="value" onKeyDown={(e) => { if (e.key === "Enter" && projEnvNewKey.trim()) { setProjSettings((p) => ({ ...p, env: { ...(p.env ?? {}), [projEnvNewKey.trim()]: projEnvNewVal } })); setProjEnvNewKey(""); setProjEnvNewVal(""); setSettingsDirty(true); } }} />
                    <button className="btn-secondary" disabled={!projEnvNewKey.trim()} onClick={() => { setProjSettings((p) => ({ ...p, env: { ...(p.env ?? {}), [projEnvNewKey.trim()]: projEnvNewVal } })); setProjEnvNewKey(""); setProjEnvNewVal(""); setSettingsDirty(true); }}>Add</button>
                  </div>
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
  const [credStatus, setCredStatus] = useState<{ global: boolean; profiles: Array<{ name: string; useDefaultAuth: boolean; hasCredentials: boolean }> } | null>(null);
  const [claudeMd, setClaudeMd] = useState("");
  const [claudeMdDirty, setClaudeMdDirty] = useState(false);
  const [model, setModel] = useState("");
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

  useEffect(() => {
    window.api.checkCredentialStatus().then(setCredStatus);
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
    window.api.getGlobalDefaults().then((d) => {
      setModel(d.model);
      setEffort(d.effortLevel);
      setCustomFlags(d.customFlags ?? "");
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
      effortLevel: effort,
      customFlags: customFlags.trim() || undefined,
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
            <div className="field" key={key}>
              <label>{key}</label>
              <div className="field-with-button">
                <input type="text" value={value} onChange={(e) => handleUpdateEnvValue(key, e.target.value)} placeholder="value" />
                <button className="btn-secondary" onClick={() => handleRemoveEnv(key)}>Remove</button>
              </div>
            </div>
          ))}
          {envEntries.length > 0 && <div className="field-divider" />}
          <div className="field">
            <label>Add Variable</label>
            <div className="field-with-button">
              <input type="text" value={newKey} onChange={(e) => setNewKey(e.target.value.replace(/\s/g, ""))} placeholder="e.g. CLAUDE_CODE_MAX_OUTPUT_TOKENS" onKeyDown={(e) => { if (e.key === "Enter") handleAddEnv(); }} />
              <input type="text" value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="value" onKeyDown={(e) => { if (e.key === "Enter") handleAddEnv(); }} />
              <button className="btn-secondary" onClick={handleAddEnv} disabled={!newKey.trim()}>Add</button>
            </div>
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
          <span className="manage-section-label">Authentication</span>
          <button className="btn-secondary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={() => window.api.checkCredentialStatus().then(setCredStatus)}>
            Refresh
          </button>
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
  onUpdate,
  onUninstall,
  onNavigateToProfile,
  onCreateDefault,
  onClose,
  onPluginsChanged,
}: Props) {
  const [activeTab, setActiveTab] = useState<ManageTab>("plugins");
  const [selectedPlugin, setSelectedPlugin] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  // Discover view state
  type PluginSubTab = "installed" | "discover" | "marketplaces";
  const [pluginSubTab, setPluginSubTab] = useState<PluginSubTab>("installed");
  const [marketplaces, setMarketplaces] = useState<Array<{ name: string; repo: string; lastUpdated: string }>>([]);
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
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="manage-dialog-body">
          {activeTab === "plugins" && (
            <>
              <div className="discover-toggle">
                <button
                  className={`discover-toggle-btn${pluginSubTab === "installed" ? " active" : ""}`}
                  onClick={() => setPluginSubTab("installed")}
                >
                  Installed
                </button>
                <button
                  className={`discover-toggle-btn${pluginSubTab === "discover" ? " active" : ""}`}
                  onClick={() => {
                    setPluginSubTab("discover");
                    if (!discoverLoaded && !discoverLoading) loadAvailablePlugins();
                  }}
                >
                  Discover
                </button>
                <button
                  className={`discover-toggle-btn${pluginSubTab === "marketplaces" ? " active" : ""}`}
                  onClick={() => {
                    setPluginSubTab("marketplaces");
                    loadMarketplaces();
                  }}
                >
                  Marketplaces
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
              ) : pluginSubTab === "marketplaces" ? (
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
                      <div className="empty-state-inline">No marketplaces registered</div>
                    ) : (
                      marketplaces.map((mp) => (
                        <div key={mp.name} className="marketplace-item">
                          <div className="marketplace-item-body">
                            <div className="marketplace-item-name">{mp.name}</div>
                            <div className="marketplace-item-repo">{mp.repo}</div>
                          </div>
                          {mp.name !== "claude-plugins-official" && (
                            <button
                              className="btn-danger-small"
                              onClick={() => handleRemoveMarketplace(mp.name)}
                              disabled={marketplaceLoading}
                              title="Remove marketplace"
                            >
                              Remove
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <div className="marketplace-add-row" style={{ padding: "8px 12px 0" }}>
                    <input
                      type="text"
                      className="marketplace-input"
                      placeholder="Install by ID (e.g. name@owner/repo)"
                      value={manualInstallInput}
                      onChange={(e) => setManualInstallInput(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleManualInstall(); }}
                      disabled={manualInstallLoading}
                    />
                    <button
                      className="btn-primary"
                      onClick={handleManualInstall}
                      disabled={!manualInstallInput.trim() || manualInstallLoading}
                    >
                      {manualInstallLoading ? "Installing..." : "Install"}
                    </button>
                  </div>
                  {manualInstallError && (
                    <div className="marketplace-error" style={{ padding: "0 12px" }}>{manualInstallError}</div>
                  )}
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
                </>
              )}
            </>
          )}

          {activeTab === "projects" && <ProjectsTab />}

          {activeTab === "prompts" && <PromptsTab />}

          {activeTab === "global" && <GlobalSettingsTab />}
        </div>
      </div>
    </div>
  );
}
