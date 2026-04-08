import { app, BrowserWindow, ipcMain, dialog } from "electron";
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
  copyCredentials,
  launchProfile,
  checkAllProfileHealth,
} from "./core";
import type { Profile } from "./types";

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

ipcMain.handle("check-profile-health", () => {
  return checkAllProfileHealth(loadProfiles());
});

ipcMain.handle("create-profile", async (_event, profile: Profile) => {
  const saved = saveProfile(profile);
  assembleProfile(saved);
  await copyCredentials(saved);
  return saved;
});

ipcMain.handle("update-profile", (_event, profile: Profile) => {
  const saved = saveProfile(profile);
  assembleProfile(saved);
  return saved;
});

ipcMain.handle("rename-profile", (_event, oldName: string, profile: Profile) => {
  const saved = renameProfile(oldName, profile);
  assembleProfile(saved);
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

  const copy: Profile = { ...source, name: copyName };
  const saved = saveProfile(copy);
  assembleProfile(saved);
  await copyCredentials(saved);
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

  const exportLine = `\nexport PATH="$PATH:${binDir}"\n`;
  const existing = fs.existsSync(rcFile) ? fs.readFileSync(rcFile, "utf-8") : "";
  if (!existing.includes(binDir)) {
    fs.appendFileSync(rcFile, exportLine);
  }
});

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (mainWindow === null) createWindow();
});
