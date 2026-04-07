import { app, BrowserWindow, ipcMain, dialog } from "electron";
import * as path from "path";
import {
  getPluginsWithItems,
  scanLocalItems,
  loadProfiles,
  saveProfile,
  deleteProfileByName,
  assembleProfile,
  copyCredentials,
  launchProfile,
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

ipcMain.handle("get-profiles", () => {
  return loadProfiles();
});

ipcMain.handle("create-profile", (_event, profile: Profile) => {
  const saved = saveProfile(profile);
  assembleProfile(saved);
  copyCredentials(saved);
  return saved;
});

ipcMain.handle("update-profile", (_event, profile: Profile) => {
  const saved = saveProfile(profile);
  assembleProfile(saved);
  return saved;
});

ipcMain.handle("delete-profile", (_event, name: string) => {
  deleteProfileByName(name);
});

ipcMain.handle("launch-profile", async (_event, name: string, directory?: string) => {
  const profiles = loadProfiles();
  const profile = profiles.find((p) => p.name === name);
  if (!profile) throw new Error(`Profile "${name}" not found`);
  assembleProfile(profile);
  await launchProfile(profile, directory);
});

ipcMain.handle("select-directory", async () => {
  if (!mainWindow) return null;
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openDirectory"],
  });
  return result.canceled ? null : result.filePaths[0];
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
