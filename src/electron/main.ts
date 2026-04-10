import { app, BrowserWindow, ipcMain, dialog, shell } from "electron";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  getPluginsWithItems,
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
  getGlobalEnv,
  saveGlobalEnv,
  getGlobalHooks,
  saveGlobalHooks,
  getGlobalDefaults,
  saveGlobalDefaults,
  getImportedProjects,
  addImportedProject,
  removeImportedProject,
  getProjectClaudeMd,
  saveProjectClaudeMd,
  getProfileConfigDir,
  getClaudeHome,
  ensureDefaultProfile,
} from "./core";
import type { Profile, Team } from "./types";

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 800,
    minHeight: 500,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#1a1a2e",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

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

  const copy: Profile = { ...source, name: copyName, alias: undefined, isDefault: undefined };
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
  // Refresh credentials from default keychain entry so profiles don't launch
  // with stale/expired OAuth tokens.
  if (profile.useDefaultAuth !== false) await syncCredentials(profile, "launch");
  // Track last launch time
  profile.lastLaunched = Date.now();
  saveProfile(profile);
  await launchProfile(profile, directory);
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
});

ipcMain.handle("uninstall-plugin", async (_event, name: string) => {
  await uninstallPlugin(name);
});

ipcMain.handle("check-plugin-updates", async () => {
  return checkPluginUpdates();
});

ipcMain.handle("get-available-plugins", async () => {
  return getAvailablePlugins();
});

ipcMain.handle("install-plugin", async (_event, pluginId: string) => {
  await installPlugin(pluginId);
});

ipcMain.handle("add-marketplace", async (_event, source: string) => {
  await addMarketplace(source);
});

ipcMain.handle("remove-marketplace", async (_event, name: string) => {
  await removeMarketplace(name);
});

ipcMain.handle("list-marketplaces", () => {
  return listMarketplaces();
});

ipcMain.handle("get-analytics", (_event, since?: number) => {
  return getAnalytics(since);
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

ipcMain.handle("launch-team", async (_event, team: Team, directory?: string) => {
  await launchTeam(team, directory);
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
ipcMain.handle("save-global-defaults", (_event, defaults: { model: string; effortLevel: string }) => saveGlobalDefaults(defaults));

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
ipcMain.handle("get-profile-config-dir", (_event, name: string) => getProfileConfigDir(name));
ipcMain.handle("get-claude-home", () => getClaudeHome());

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(() => {
  ensureDefaultProfile();
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});
