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
  useDefaultAuth?: boolean; // symlink default credentials (default: true)
  tags?: string[];
  isDefault?: boolean; // only one profile can be true — intercepts bare `claude`
  disabledHooks?: Record<string, number[]>; // event name -> indices of hooks to skip from global
  lastLaunched?: number; // timestamp of last launch
}

/** A member of a team. */
export interface TeamMember {
  profile: string;
  role: string;
  instructions: string;
  isLead: boolean;
}

/** A named team of profiles. */
export interface Team {
  name: string;
  description: string;
  members: TeamMember[];
  model?: "opus" | "sonnet" | "haiku";
  effortLevel?: "low" | "medium" | "high" | "max";
  customFlags?: string;
  tags?: string[];
}

/** Merge preview for a team. */
export interface MergePreview {
  plugins: string[];
  mcpServers: string[];
  agents: Array<{
    name: string;
    profile: string;
    instructions: string;
  }>;
  settings: {
    model?: string;
    effortLevel?: string;
    customFlags?: string;
    source: string;
  };
  conflicts: string[];
}

/** A reusable prompt/template for CLAUDE.md content. */
export interface Prompt {
  id: string;
  name: string;
  description: string;
  tags: string[];
  content: string;
  createdAt: number;
  updatedAt: number;
}

/** Stored profiles file format. */
export interface ProfilesStore {
  profiles: Record<string, Profile>;
}

/** Stored teams file format (separate from profiles). */
export interface TeamsStore {
  teams: Record<string, Team>;
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
  ensureDefaultProfile: () => Promise<void>;
  updatePlugin: (name: string) => Promise<void>;
  uninstallPlugin: (name: string) => Promise<void>;
  checkPluginUpdates: () => Promise<Record<string, string>>;
  getTeams: () => Promise<Team[]>;
  saveTeam: (team: Team) => Promise<Team>;
  deleteTeam: (name: string) => Promise<void>;
  renameTeam: (oldName: string, team: Team) => Promise<Team>;
  getTeamMergePreview: (team: Team) => Promise<MergePreview>;
  checkTeamHealth: () => Promise<Record<string, string[]>>;
  // Global settings
  getGlobalClaudeMd: () => Promise<string>;
  saveGlobalClaudeMd: (content: string) => Promise<void>;
  getPrompts: () => Promise<Prompt[]>;
  savePrompts: (prompts: Prompt[]) => Promise<void>;
  exportPrompt: (prompt: Prompt) => Promise<string | null>;
  importPrompt: () => Promise<Prompt | null>;
  checkCredentialStatus: () => Promise<{ global: boolean; profiles: Array<{ name: string; useDefaultAuth: boolean; hasCredentials: boolean }> }>;
  runDiagnostics: () => Promise<{ version: string; configDir: string; claudeHome: string; profileCount: number; teamCount: number; issues: string[] }>;
  getAppPreferences: () => Promise<{ fontSize: number; theme?: string }>;
  saveAppPreferences: (prefs: { fontSize: number; theme?: string }) => Promise<void>;
  getGlobalEnv: () => Promise<Record<string, string>>;
  saveGlobalEnv: (env: Record<string, string>) => Promise<void>;
  getGlobalHooks: () => Promise<Record<string, any>>;
  saveGlobalHooks: (hooks: Record<string, any>) => Promise<void>;
  getGlobalDefaults: () => Promise<{ model: string; effortLevel: string; env?: Record<string, string>; customFlags?: string }>;
  saveGlobalDefaults: (defaults: { model: string; effortLevel: string; env?: Record<string, string>; customFlags?: string }) => Promise<void>;
  // Projects
  getImportedProjects: () => Promise<string[]>;
  addImportedProject: (dir: string) => Promise<string[]>;
  removeImportedProject: (dir: string) => Promise<string[]>;
  getProjectClaudeMd: (dir: string) => Promise<string>;
  saveProjectClaudeMd: (dir: string, content: string) => Promise<void>;
  // Project file operations
  readProjectFile: (dir: string, relativePath: string) => Promise<string>;
  writeProjectFile: (dir: string, relativePath: string, content: string) => Promise<void>;
  deleteProjectFile: (dir: string, relativePath: string) => Promise<void>;
  getProjectMcpConfig: (dir: string) => Promise<Record<string, { type: string; command?: string; url?: string }>>;
  saveProjectMcpConfig: (dir: string, servers: Record<string, { type: string; command?: string; url?: string }>) => Promise<void>;
  getProjectSettings: (dir: string) => Promise<Record<string, any>>;
  saveProjectSettings: (dir: string, settings: Record<string, any>) => Promise<void>;
  getGitContext: (dir: string) => Promise<{ branch: string; dirty: boolean; isRepo: boolean }>;
  openInFinder: (path: string) => Promise<void>;
  getProfileConfigDir: (name: string) => Promise<string>;
  getClaudeHome: () => Promise<string>;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
