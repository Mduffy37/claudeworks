/** A single installed plugin from installed_plugins.json. */
export interface PluginEntry {
  name: string; // e.g. "superpowers@claude-plugins-official"
  scope: "user" | "project";
  installPath: string;
  version: string;
  marketplace: string; // e.g. "claude-plugins-official"
  pluginName: string; // e.g. "superpowers"
  projectPath?: string;
}

/** An individual skill, agent, or command within a plugin. */
export interface PluginItem {
  name: string;
  type: "skill" | "agent" | "command";
  plugin: string; // parent plugin name
  path: string; // path to the .md file
  userInvocable: boolean;
}

/** A plugin with its scanned items attached. */
export interface PluginWithItems extends PluginEntry {
  items: PluginItem[];
}

/** A named Claude Code profile. */
export interface Profile {
  name: string;
  plugins: string[]; // plugin names to include
  excludedItems: Record<string, string[]>; // pluginName -> excluded item names
  directory?: string; // default working directory
  description: string;
}

/** Stored profiles file format. */
export interface ProfilesStore {
  profiles: Record<string, Profile>;
}

/** IPC API exposed to the renderer via contextBridge. */
export interface ElectronAPI {
  getPlugins: () => Promise<PluginWithItems[]>;
  getProfiles: () => Promise<Profile[]>;
  createProfile: (profile: Profile) => Promise<Profile>;
  updateProfile: (profile: Profile) => Promise<Profile>;
  deleteProfile: (name: string) => Promise<void>;
  launchProfile: (name: string, directory?: string) => Promise<void>;
  selectDirectory: () => Promise<string | null>;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
