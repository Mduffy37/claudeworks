import { contextBridge, ipcRenderer } from "electron";
import type { ElectronAPI } from "./types";

const api: ElectronAPI = {
  getPlugins: () => ipcRenderer.invoke("get-plugins"),
  getLocalItems: (directory) => ipcRenderer.invoke("get-local-items", directory),
  getMcpServers: (directory) => ipcRenderer.invoke("get-mcp-servers", directory),
  getProfiles: () => ipcRenderer.invoke("get-profiles"),
  createProfile: (profile) => ipcRenderer.invoke("create-profile", profile),
  updateProfile: (profile) => ipcRenderer.invoke("update-profile", profile),
  renameProfile: (oldName, profile) => ipcRenderer.invoke("rename-profile", oldName, profile),
  deleteProfile: (name) => ipcRenderer.invoke("delete-profile", name),
  duplicateProfile: (name) => ipcRenderer.invoke("duplicate-profile", name),
  launchProfile: (name, directory) =>
    ipcRenderer.invoke("launch-profile", name, directory),
  checkProfileHealth: () => ipcRenderer.invoke("check-profile-health"),
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  isBinInPath: () => ipcRenderer.invoke("is-bin-in-path"),
  addBinToPath: () => ipcRenderer.invoke("add-bin-to-path"),
  updatePlugin: (name) => ipcRenderer.invoke("update-plugin", name),
  uninstallPlugin: (name) => ipcRenderer.invoke("uninstall-plugin", name),
  checkPluginUpdates: () => ipcRenderer.invoke("check-plugin-updates"),
  getTeams: () => ipcRenderer.invoke("get-teams"),
  saveTeam: (team) => ipcRenderer.invoke("save-team", team),
  deleteTeam: (name) => ipcRenderer.invoke("delete-team", name),
  renameTeam: (oldName, team) => ipcRenderer.invoke("rename-team", oldName, team),
  getTeamMergePreview: (team) => ipcRenderer.invoke("get-team-merge-preview", team),
  checkTeamHealth: () => ipcRenderer.invoke("check-team-health"),
};

contextBridge.exposeInMainWorld("api", api);
