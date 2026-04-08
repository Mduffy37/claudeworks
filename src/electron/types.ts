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
  description: string;
  type: "skill" | "agent" | "command";
  plugin: string; // parent plugin name
  path: string; // path to the .md file
  userInvocable: boolean;
  dependencies: string[]; // names of items this depends on (e.g. "superpowers:writing-plans")
}

/** A plugin's hook definitions. */
export interface PluginHook {
  event: string; // e.g. "SessionStart", "PreToolUse"
  command: string;
}

/** Resolved dependency: which items are needed if a given item is enabled. */
export interface DependencyMap {
  [itemId: string]: string[]; // "plugin:item" -> ["plugin:otherItem", ...]
}

/** An MCP server provided by a plugin. */
export interface PluginMcp {
  name: string; // server name (e.g. "context7", "github")
  type: "stdio" | "http" | "unknown";
  command?: string; // for stdio: the command to run
  url?: string; // for http: the endpoint
  plugin: string; // parent plugin name
}

/** A plugin with its scanned items attached. */
export interface PluginWithItems extends PluginEntry {
  items: PluginItem[];
  hooks: PluginHook[];
  mcpServers: PluginMcp[];
}

/** A standalone MCP server from ~/.claude.json (user or project level). */
export interface StandaloneMcp {
  name: string;
  type: "stdio" | "http" | "unknown";
  command?: string;
  url?: string;
  scope: "user" | "project";
  projectPath?: string;
}

/** A local skill/agent/command from the working directory's .claude/ folder. */
export interface LocalItem {
  name: string;
  type: "skill" | "agent" | "command";
  path: string; // absolute path to the .md file
}

/** A named Claude Code profile. */
export interface Profile {
  name: string;
  plugins: string[];
  excludedItems: Record<string, string[]>;
  directory?: string; // primary directory (first in directories list)
  directories?: string[]; // all configured directories
  description: string;
  alias?: string; // CLI alias (e.g. "claude-research")
  // Session settings
  model?: "opus" | "sonnet" | "haiku";
  effortLevel?: "low" | "medium" | "high" | "max";
  voiceEnabled?: boolean;
  env?: Record<string, string>;
  statusLine?: { type: "command"; command: string } | null;
  customClaudeMd?: string; // per-profile CLAUDE.md content (appended to global)
  disabledMcpServers?: Record<string, string[]>;
  // key:   directory path (e.g. "/Users/me/Documents/The Vault")
  // value: array of disabled MCP server names for that directory
  // absent key = all MCPs enabled for that directory
  launchFlags?: {
    dangerouslySkipPermissions?: boolean;
    verbose?: boolean;
  };
  customFlags?: string; // additional CLI flags as raw text
}

/** Stored profiles file format. */
export interface ProfilesStore {
  profiles: Record<string, Profile>;
}

/** IPC API exposed to the renderer via contextBridge. */
export interface ElectronAPI {
  getPlugins: () => Promise<PluginWithItems[]>;
  getLocalItems: (directory: string) => Promise<LocalItem[]>;
  getMcpServers: (directory?: string) => Promise<StandaloneMcp[]>;
  getProfiles: () => Promise<Profile[]>;
  createProfile: (profile: Profile) => Promise<Profile>;
  updateProfile: (profile: Profile) => Promise<Profile>;
  renameProfile: (oldName: string, profile: Profile) => Promise<Profile>;
  deleteProfile: (name: string) => Promise<void>;
  duplicateProfile: (name: string) => Promise<Profile>;
  launchProfile: (name: string, directory?: string) => Promise<void>;
  checkProfileHealth: () => Promise<Record<string, string[]>>;
  selectDirectory: () => Promise<string | null>;
  isBinInPath: () => Promise<boolean>;
  addBinToPath: () => Promise<void>;
  updatePlugin: (name: string) => Promise<void>;
  uninstallPlugin: (name: string) => Promise<void>;
  checkPluginUpdates: () => Promise<Record<string, string>>;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
