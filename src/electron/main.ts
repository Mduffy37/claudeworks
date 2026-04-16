import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  getPluginsWithItems,
  invalidatePluginCaches,
  scanLocalItems,
  scanMcpServers,
  loadProfiles,
  saveProfile,
  renameProfile,
  deleteProfileByName,
  assembleProfile,
  syncCredentials,
  launchProfile,
  checkAllProfileHealth,
  updatePlugin,
  uninstallPlugin,
  checkPluginUpdates,
  getAvailablePlugins,
  installPlugin,
  addMarketplace,
  removeMarketplace,
  updateMarketplace,
  updateAllMarketplaces,
  listMarketplaces,
  getAnalytics,
  getActiveSessions,
  checkForAppUpdate,
  loadTeams,
  saveTeam,
  renameTeam,
  deleteTeamByName,
  getTeamMergePreview,
  checkAllTeamHealth,
  launchTeam,
  getGlobalClaudeMd,
  saveGlobalClaudeMd,
  getPrompts,
  savePrompts,
  checkCredentialStatus,
  runDiagnostics,
  // NOTE: runProfilesDoctor is imported separately from ./doctor below,
  // not from ./core — keeps the doctor module's dependency surface small.
  getGlobalEnv,
  saveGlobalEnv,
  getGlobalHooks,
  saveGlobalHooks,
  getGlobalDefaults,
  saveGlobalDefaults,
  getFavouritePlugins,
  saveFavouritePlugins,
  getImportedProjects,
  addImportedProject,
  removeImportedProject,
  getProjectClaudeMd,
  saveProjectClaudeMd,
  getProfileConfigDir,
  getClaudeHome,
  ensureDefaultProfile,
  ensureBuiltinPlugin,
  getCuratedMarketplace,
  refreshCuratedMarketplace,
  getCuratedIndex,
  refreshCuratedIndex,
  fetchUpstreamMarketplace,
  fetchPluginItems,
  fetchRepoReadme,
  getGitHubBackendState,
  getStatusLineConfig,
  setStatusLineConfig,
  resetStatusLineConfig,
  renderStatusLinePreview,
  checkAliasConflict,
} from "./core";
import { runProfilesDoctor } from "./doctor";
import { getKnownEnvVars } from "./known-env-vars";
import { resolvePlugins } from "./plugin-resolver";
import type { Profile, Team } from "./types";

let mainWindow: BrowserWindow | null = null;

const PREFS_PATH = path.join(os.homedir(), ".claude-profiles", "global-defaults.json");

function loadWindowBounds(): { x?: number; y?: number; width: number; height: number } {
  try {
    const data = JSON.parse(fs.readFileSync(PREFS_PATH, "utf-8"));
    if (data.windowBounds?.width && data.windowBounds?.height) {
      return data.windowBounds;
    }
  } catch {}
  return { width: 1280, height: 820 };
}

function saveWindowBounds(bounds: { x: number; y: number; width: number; height: number }): void {
  let data: any = {};
  try { data = JSON.parse(fs.readFileSync(PREFS_PATH, "utf-8")); } catch {}
  data.windowBounds = bounds;
  try { fs.writeFileSync(PREFS_PATH, JSON.stringify(data, null, 2)); } catch {}
}

function createWindow(): void {
  const bounds = loadWindowBounds();
  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 900,
    minHeight: 550,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#1a1a2e",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Persist window bounds on resize/move (debounced)
  let boundsTimer: ReturnType<typeof setTimeout> | null = null;
  const persistBounds = () => {
    if (boundsTimer) clearTimeout(boundsTimer);
    boundsTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        saveWindowBounds(mainWindow.getBounds());
      }
    }, 500);
  };
  mainWindow.on("resize", persistBounds);
  mainWindow.on("move", persistBounds);

  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "ui", "index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle("get-plugins", () => {
  return getPluginsWithItems();
});

ipcMain.handle("get-local-items", (_event, directory: string) => {
  return scanLocalItems(directory);
});

ipcMain.handle("get-mcp-servers", (_event, directory?: string) => {
  return scanMcpServers(directory);
});

ipcMain.handle("get-profiles", () => {
  return loadProfiles();
});

ipcMain.handle("ensure-default-profile", () => {
  ensureDefaultProfile();
});

ipcMain.handle("check-profile-health", () => {
  return checkAllProfileHealth(loadProfiles());
});

ipcMain.handle("create-profile", async (_event, profile: Profile) => {
  const saved = saveProfile(profile);
  assembleProfile(saved);
  if (saved.useDefaultAuth !== false) await syncCredentials(saved, "seed");
  return saved;
});

ipcMain.handle("update-profile", async (_event, profile: Profile) => {
  const saved = saveProfile(profile);
  assembleProfile(saved);
  if (saved.useDefaultAuth !== false) await syncCredentials(saved, "seed");
  return saved;
});

ipcMain.handle("rename-profile", async (_event, oldName: string, profile: Profile) => {
  const oldConfigDir = path.join(os.homedir(), ".claude-profiles", oldName, "config");
  const saved = renameProfile(oldName, profile);
  assembleProfile(saved);
  if (saved.useDefaultAuth !== false) await syncCredentials(saved, "rename", oldConfigDir);
  return saved;
});

ipcMain.handle("delete-profile", async (_event, name: string) => {
  await deleteProfileByName(name);
});

ipcMain.handle("duplicate-profile", async (_event, name: string) => {
  const profiles = loadProfiles();
  const source = profiles.find((p) => p.name === name);
  if (!source) throw new Error(`Profile "${name}" not found`);

  // Generate a unique copy name
  const existingNames = new Set(profiles.map((p) => p.name));
  let copyName = `${source.name}-copy`;
  let attempt = 2;
  while (existingNames.has(copyName)) {
    copyName = `${source.name}-copy-${attempt}`;
    attempt++;
  }

  const copy: Profile = { ...source, name: copyName, aliases: undefined, isDefault: undefined };
  const saved = saveProfile(copy);
  assembleProfile(saved);
  if (saved.useDefaultAuth !== false) await syncCredentials(saved, "seed");
  return saved;
});

ipcMain.handle("launch-profile", async (_event, name: string, directory?: string) => {
  const profiles = loadProfiles();
  const profile = profiles.find((p) => p.name === name);
  if (!profile) throw new Error(`Profile "${name}" not found`);
  try {
    assembleProfile(profile);
  } catch (err: any) {
    throw new Error(`Profile assembly failed: ${err?.message ?? "unknown error"}`);
  }
  if (profile.useDefaultAuth !== false) await syncCredentials(profile, "launch");
  profile.lastLaunched = Date.now();
  saveProfile(profile);
  await launchProfile(profile, directory);
});

ipcMain.handle("launch-profile-with-options", async (_event, name: string, directory?: string, options?: any) => {
  const profiles = loadProfiles();
  const profile = profiles.find((p) => p.name === name);
  if (!profile) throw new Error(`Profile "${name}" not found`);
  try {
    assembleProfile(profile);
  } catch (err: any) {
    throw new Error(`Profile assembly failed: ${err?.message ?? "unknown error"}`);
  }
  if (profile.useDefaultAuth !== false) await syncCredentials(profile, "launch");
  profile.lastLaunched = Date.now();
  saveProfile(profile);
  await launchProfile(profile, directory, options);
});

ipcMain.handle("select-directory", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("is-bin-in-path", () => {
  const binDir = path.join(os.homedir(), ".claude-profiles", "bin");
  const shell = process.env.SHELL ?? "/bin/zsh";
  const rcFile = shell.includes("zsh")
    ? path.join(os.homedir(), ".zshrc")
    : path.join(os.homedir(), ".bashrc");
  if (!fs.existsSync(rcFile)) return false;
  return fs.readFileSync(rcFile, "utf-8").includes(binDir);
});

ipcMain.handle("add-bin-to-path", () => {
  const binDir = path.join(os.homedir(), ".claude-profiles", "bin");
  fs.mkdirSync(binDir, { recursive: true });

  const shell = process.env.SHELL ?? "/bin/zsh";
  const rcFile = shell.includes("zsh")
    ? path.join(os.homedir(), ".zshrc")
    : path.join(os.homedir(), ".bashrc");

  const exportLine = `\nexport PATH="${binDir}:$PATH"\n`;
  const existing = fs.existsSync(rcFile) ? fs.readFileSync(rcFile, "utf-8") : "";
  if (!existing.includes(binDir)) {
    fs.appendFileSync(rcFile, exportLine);
  }
});

ipcMain.handle("update-plugin", async (_event, name: string) => {
  await updatePlugin(name);
  invalidatePluginCaches();
});

ipcMain.handle("uninstall-plugin", async (_event, name: string) => {
  await uninstallPlugin(name);
  invalidatePluginCaches();
});

ipcMain.handle("check-plugin-updates", async () => {
  return checkPluginUpdates();
});

ipcMain.handle("get-available-plugins", async () => {
  return getAvailablePlugins();
});

ipcMain.handle("install-plugin", async (_event, pluginId: string) => {
  await installPlugin(pluginId);
  invalidatePluginCaches();
});

ipcMain.handle("add-marketplace", async (_event, source: string) => {
  await addMarketplace(source);
  invalidatePluginCaches();
});

ipcMain.handle("remove-marketplace", async (_event, name: string) => {
  await removeMarketplace(name);
  invalidatePluginCaches();
});

ipcMain.handle("update-marketplace", (_event, name: string) => updateMarketplace(name));
ipcMain.handle("update-all-marketplaces", () => updateAllMarketplaces());

ipcMain.handle("list-marketplaces", () => {
  return listMarketplaces();
});

ipcMain.handle("get-analytics", (_event, since?: number, project?: string) => {
  return getAnalytics(since, project);
});

ipcMain.handle("get-active-sessions", () => {
  return getActiveSessions();
});

ipcMain.handle("check-for-app-update", async () => {
  return checkForAppUpdate();
});

ipcMain.handle("get-teams", () => {
  return loadTeams();
});

ipcMain.handle("save-team", (_event, team: Team) => {
  return saveTeam(team);
});

ipcMain.handle("rename-team", (_event, oldName: string, team: Team) => {
  return renameTeam(oldName, team);
});

ipcMain.handle("delete-team", async (_event, name: string) => {
  deleteTeamByName(name);
});

ipcMain.handle("get-team-merge-preview", (_event, team: Team) => {
  return getTeamMergePreview(team);
});

ipcMain.handle("check-team-health", () => {
  return checkAllTeamHealth(loadTeams());
});

ipcMain.handle("check-tmux-installed", () => {
  try {
    execFileSync("which", ["tmux"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle("launch-team", async (_event, team: Team, directory?: string) => {
  await launchTeam(team, directory);
});

ipcMain.handle("launch-team-with-options", async (_event, team: Team, directory?: string, options?: any) => {
  await launchTeam(team, directory, options);
});

// Global settings
ipcMain.handle("get-global-claude-md", () => getGlobalClaudeMd());
ipcMain.handle("save-global-claude-md", (_event, content: string) => saveGlobalClaudeMd(content));
ipcMain.handle("get-prompts", () => getPrompts());
ipcMain.handle("save-prompts", (_event, prompts: any[]) => savePrompts(prompts));
ipcMain.handle("export-prompt", async (_event, prompt: any) => {
  const name = (prompt.name || "prompt").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const downloadsPath = path.join(os.homedir(), "Downloads", `${name}.md`);
  fs.writeFileSync(downloadsPath, prompt.content ?? "", "utf-8");
  return downloadsPath;
});
ipcMain.handle("import-prompt", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Import Prompt",
    filters: [{ name: "Markdown", extensions: ["md"] }],
    properties: ["openFile"],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  try {
    const content = fs.readFileSync(result.filePaths[0], "utf-8");
    const fileName = path.basename(result.filePaths[0], ".md");
    return {
      id: `prompt-${Date.now()}`,
      name: fileName,
      description: "",
      tags: [],
      content,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  } catch {
    return null;
  }
});
ipcMain.handle("check-credential-status", () => checkCredentialStatus());
ipcMain.handle("run-diagnostics", () => runDiagnostics());
ipcMain.handle("run-profiles-doctor", (_e, mode: "detect" | "repair") => runProfilesDoctor(mode));
ipcMain.handle("export-diagnostics", async () => {
  const { exportDiagnostics } = require("./core");
  const data = await exportDiagnostics();
  const { filePath, canceled } = await dialog.showSaveDialog({
    defaultPath: `claude-profiles-diagnostics-${Date.now()}.json`,
    filters: [{ name: "JSON", extensions: ["json"] }],
  });
  if (canceled || !filePath) return { ok: false, cancelled: true };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n");
  return { ok: true, path: filePath };
});
ipcMain.handle("get-app-preferences", () => {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude-profiles", "global-defaults.json"), "utf-8"));
    return { fontSize: data.appFontSize ?? 1, theme: data.appTheme ?? "dark" };
  } catch { return { fontSize: 1, theme: "dark" }; }
});
ipcMain.handle("save-app-preferences", (_event, prefs: { fontSize: number; theme?: string }) => {
  const filePath = path.join(os.homedir(), ".claude-profiles", "global-defaults.json");
  let data: any = {};
  try { data = JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch {}
  data.appFontSize = prefs.fontSize;
  if (prefs.theme) data.appTheme = prefs.theme;
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
});
ipcMain.handle("get-global-env", () => getGlobalEnv());
ipcMain.handle("save-global-env", (_event, env: Record<string, string>) => saveGlobalEnv(env));
ipcMain.handle("get-global-hooks", () => getGlobalHooks());
ipcMain.handle("save-global-hooks", (_event, hooks: Record<string, any>) => saveGlobalHooks(hooks));
ipcMain.handle("get-global-defaults", () => getGlobalDefaults());
ipcMain.handle("save-global-defaults", (_event, defaults: { model: string; opusContext?: "200k" | "1m"; sonnetContext?: "200k" | "1m"; effortLevel: string }) => saveGlobalDefaults(defaults));
ipcMain.handle("get-favourite-plugins", () => getFavouritePlugins());
ipcMain.handle("save-favourite-plugins", (_event, ids: string[]) => saveFavouritePlugins(ids));

// Projects
ipcMain.handle("get-imported-projects", () => getImportedProjects());
ipcMain.handle("add-imported-project", (_event, dir: string) => addImportedProject(dir));
ipcMain.handle("remove-imported-project", (_event, dir: string) => removeImportedProject(dir));
ipcMain.handle("get-project-claude-md", (_event, dir: string) => getProjectClaudeMd(dir));
ipcMain.handle("save-project-claude-md", (_event, dir: string, content: string) => saveProjectClaudeMd(dir, content));

// Project file operations
ipcMain.handle("read-project-file", async (_event, dir: string, relativePath: string) => {
  const filePath = path.join(dir, relativePath);
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
});

ipcMain.handle("write-project-file", async (_event, dir: string, relativePath: string, content: string) => {
  const filePath = path.join(dir, relativePath);
  const dirPath = path.dirname(filePath);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
});

ipcMain.handle("delete-project-file", async (_event, dir: string, relativePath: string) => {
  const filePath = path.join(dir, relativePath);
  if (fs.existsSync(filePath)) {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) {
      fs.rmSync(filePath, { recursive: true });
    } else {
      fs.unlinkSync(filePath);
    }
  }
});

ipcMain.handle("get-project-mcp-config", async (_event, dir: string) => {
  const mcpPath = path.join(dir, ".mcp.json");
  try {
    const data = JSON.parse(fs.readFileSync(mcpPath, "utf-8"));
    return data.mcpServers ?? data;
  } catch {
    return {};
  }
});

ipcMain.handle("save-project-mcp-config", async (_event, dir: string, servers: Record<string, any>) => {
  const mcpPath = path.join(dir, ".mcp.json");
  fs.writeFileSync(mcpPath, JSON.stringify({ mcpServers: servers }, null, 2));
});

ipcMain.handle("get-project-settings", async (_event, dir: string) => {
  const settingsPath = path.join(dir, ".claude", "settings.json");
  try {
    return JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
  } catch {
    return {};
  }
});

ipcMain.handle("save-project-settings", async (_event, dir: string, settings: Record<string, any>) => {
  const settingsPath = path.join(dir, ".claude", "settings.json");
  const dirPath = path.dirname(settingsPath);
  if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
});

// Filesystem
ipcMain.handle("get-git-context", async (_event, dir: string) => {
  const { execSync } = require("child_process");
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", { cwd: dir, encoding: "utf-8" }).trim();
    const status = execSync("git status --porcelain", { cwd: dir, encoding: "utf-8" }).trim();
    return { branch, dirty: status.length > 0, isRepo: true };
  } catch {
    return { branch: "", dirty: false, isRepo: false };
  }
});
ipcMain.handle("open-in-finder", (_event, filePath: string) => shell.openPath(filePath));
ipcMain.handle("reveal-in-finder", (_event, filePath: string) => shell.showItemInFolder(filePath));
ipcMain.handle("open-external-url", (_event, url: string) => shell.openExternal(url));
ipcMain.handle("get-profile-config-dir", (_event, name: string) => getProfileConfigDir(name));
ipcMain.handle("get-claude-home", () => getClaudeHome());
ipcMain.handle("get-curated-marketplace", () => getCuratedMarketplace());
ipcMain.handle("refresh-curated-marketplace", () => refreshCuratedMarketplace());
ipcMain.handle("get-curated-index", () => getCuratedIndex());
ipcMain.handle("refresh-curated-index", () => refreshCuratedIndex());
ipcMain.handle("fetch-upstream-marketplace", (_event, source: string) => fetchUpstreamMarketplace(source));
ipcMain.handle("fetch-plugin-items", (_event, source: string, pluginPath: string) => fetchPluginItems(source, pluginPath));
ipcMain.handle("fetch-repo-readme", (_event, source: string) => fetchRepoReadme(source));
ipcMain.handle("get-github-backend", () => getGitHubBackendState());

// Status line config
ipcMain.handle("get-statusline-config", () => getStatusLineConfig());
ipcMain.handle("set-statusline-config", (_event, config) => setStatusLineConfig(config));
ipcMain.handle("reset-statusline-config", () => resetStatusLineConfig());
ipcMain.handle("render-statusline-preview", (_event, config, mockSession) =>
  renderStatusLinePreview(config, mockSession),
);

// Plugin resolver
ipcMain.handle("resolve-plugins", (_event, ids: string[]) => resolvePlugins(ids));

// Alias conflict detection
ipcMain.handle("check-alias-conflict", (_event, aliasName: string, profileName: string) => checkAliasConflict(aliasName, profileName));

// Known env vars
ipcMain.handle("get-known-env-vars", () => getKnownEnvVars());

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  ensureBuiltinPlugin();
  ensureDefaultProfile();
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});
