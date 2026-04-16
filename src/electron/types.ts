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

/**
 * Provenance marker detected on a local plugin. Returned by a detector in the
 * scanner's detector registry. `type` identifies the detector; `groupKey`,
 * when present, collapses multiple skills sharing the same key into a single
 * synthetic plugin card (used for multi-skill installers like skill-cli).
 */
export interface PluginSource {
  type: string;                    // detector name: "skillfish" | "git" | "skill-cli" | ...
  label?: string;                  // pill text in the UI (falls back to `type`)
  groupKey?: string;               // skills sharing this key collapse into one plugin
  groupName?: string;              // display name for the grouped plugin card
  tooltip?: string;                // pre-formatted tooltip text for the pill
  metadata?: Record<string, any>;
}

export interface KnownEnvVar {
  name: string;
  description: string;
  values: string[] | null;
  scope: "global" | "project" | "both";
  requiredFor?: string;
}

export interface ResolvedPlugin {
  id: string;
  source: "marketplace" | "local" | "skill-lock" | "git" | "builtin" | "framework";
  path: string;
  label?: string;
}

/** A plugin with its scanned items attached. */
export interface PluginWithItems extends PluginEntry {
  items: PluginItem[];
  hooks: PluginHook[];
  mcpServers: PluginMcp[];
  /** Optional install-source provenance for local plugins (e.g. skillfish). */
  source?: PluginSource;
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
  opusContext?: "200k" | "1m";   // default 1m
  sonnetContext?: "200k" | "1m"; // default 200k — 1m is billed as extra usage
  effortLevel?: "low" | "medium" | "high" | "max";
  voiceEnabled?: boolean;
  env?: Record<string, string>;
  statusLine?: { type: "command"; command: string } | null;
  customClaudeMd?: string; // per-profile CLAUDE.md content (appended to global)
  workflow?: string; // body of the /workflow command, written to <config>/commands/workflow.md
  tools?: string; // body of the /tools command — a persistent tool-set reference with rationale, written to <config>/commands/tools.md
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
  favourite?: boolean;
  projects?: string[]; // imported project directory paths this profile is associated with (categorization, not launch targets)
  /**
   * Optional per-profile status line config. When present, overrides the
   * global `~/.claude/statusline-config.json` for sessions launched via
   * this profile. When undefined, the global config is used.
   */
  statusLineConfig?: StatusLineConfig;
}

/** Named colours matching Claude Code's internal teammate palette. */
export type TeammateColour = "red" | "blue" | "green" | "yellow" | "purple" | "orange" | "pink" | "cyan";

/** A member of a team. */
export interface TeamMember {
  profile: string;
  role: string;
  instructions: string;
  isLead: boolean;
  colour?: TeammateColour;
}

/** A named team of profiles. */
export interface Team {
  name: string;
  description: string;
  members: TeamMember[];
  model?: "opus" | "sonnet" | "haiku";
  opusContext?: "200k" | "1m";   // default 1m
  sonnetContext?: "200k" | "1m"; // default 200k — 1m is billed as extra usage
  effortLevel?: "low" | "medium" | "high" | "max";
  customFlags?: string;
  tags?: string[];
  favourite?: boolean;
  projects?: string[]; // imported project directory paths this team is associated with
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

/** A curated marketplace listing from the marketplace repo (v2 schema). */
export interface CuratedMarketplace {
  id: string;              // upstream marketplace's internal `name` field, used for plugin ↔ marketplace filter matching
  source: string;          // owner/repo — passed to `claude plugin marketplace add <source>`
  displayName: string;
  description: string;
  author: string;
  sourceUrl: string;       // browser-friendly GitHub URL
  pluginCount: number;     // size indicator, allowed to be mildly stale
  collections: string[];
  addedAt: string;
  featured: boolean;
}

/** A curated plugin listing from the marketplace repo. */
export interface CuratedPlugin {
  pluginId: string;
  displayName: string;
  description: string;
  marketplace: string;     // references a CuratedMarketplace.id when available, else informational
  sourceUrl: string;
  author: string;
  addedAt: string;
  collections: string[];
  featured: boolean;
}

/** A collection definition from the marketplace repo. */
export interface CuratedCollection {
  id: string;
  name: string;
  description: string;
  icon: string;
}

/** Combined curated marketplace data. */
export interface CuratedMarketplaceData {
  marketplaces: CuratedMarketplace[];
  plugins: CuratedPlugin[];
  collections: CuratedCollection[];
}

/** A single entry in the curated search index — flat, searchable, generated. */
export interface CuratedIndexEntry {
  kind: "marketplace" | "plugin" | "skill" | "command" | "agent" | "mcpServer";
  id: string;
  displayName: string;
  description: string;
  sourceUrl?: string;
  /** Breadcrumb path: parent marketplace id, then parent plugin id for deeper items. */
  path: string[];
  /** Present on marketplaces — collections tagged on that marketplace. */
  collections?: string[];
  /** Present on marketplaces — maintainer featured flag. */
  featured?: boolean;
  /** Present on skills — whether the user can explicitly invoke it. */
  userInvocable?: boolean;
  /** Present on mcpServer — how the server is launched/reached. */
  transport?: "stdio" | "http" | "sse";
}

/** Pre-built search index fetched from the curator repo. Generated snapshot — not hand-edited. */
export interface CuratedIndex {
  version: number;
  generatedAt: string;
  sourceCommit?: string;
  entries: CuratedIndexEntry[];
}

/** An available (not yet installed) plugin from a configured marketplace. */
export interface AvailablePlugin {
  pluginId: string;
  name: string;
  description: string;
  marketplaceName: string;
  source: { source: string; url?: string; sha?: string };
  installCount: number;
}

/** An installed plugin as reported by `claude plugin list --json`. */
export interface InstalledPluginInfo {
  id: string;
  version: string;
  scope: string;
  enabled: boolean;
  installPath: string;
  installedAt: string;
  lastUpdated: string;
}

/** Stored profiles file format. */
export interface ProfilesStore {
  /**
   * Schema version of the persisted file. Bumped whenever the shape of a
   * stored profile changes in a way that requires migration. Optional on
   * read for backwards compatibility with any pre-versioned data on disk.
   */
  schemaVersion?: number;
  profiles: Record<string, Profile>;
}

/** Stored teams file format (separate from profiles). */
export interface TeamsStore {
  /** See ProfilesStore.schemaVersion. */
  schemaVersion?: number;
  teams: Record<string, Team>;
}

/** One-shot launch overrides from the launch settings popover. */
export interface LaunchOptions {
  terminalApp?: string;
  tmuxMode?: "cc" | "plain" | "none";
  customFlags?: string;
  dangerouslySkipPermissions?: boolean;
}

/**
 * A single widget entry in a status line config.
 *
 * Special sentinel: an entry with `id: "break"` marks a section boundary
 * in the flat widget list. The Python renderer groups widgets by break
 * markers and joins the groups with the section separator. Break entries
 * don't need `options`.
 */
export interface StatusLineWidget {
  id: string;
  enabled: boolean;
  options?: Record<string, unknown>;
}

/** Global separator characters used between widgets (field) and between sections. */
export interface StatusLineSeparators {
  field?: string;
  section?: string;
  /** Hex color for the field separator glyph. Falls back to masterColor, then CB. */
  fieldColor?: string;
  /** Hex color for the section separator glyph. Falls back to masterColor, then CB. */
  sectionColor?: string;
}

/**
 * Full status line config stored at ~/.claude/statusline-config.json.
 *
 * v2 schema: flat widget list with "break" sentinel entries marking
 * section boundaries. v1 configs (with `sections`) are migrated on read
 * by `getStatusLineConfig` / Python `load_config`.
 */
export interface StatusLineConfig {
  version: number;
  /**
   * Optional top-level theme color. Applies to every widget's primary color
   * AND to both separators, unless the widget/separator sets its own color
   * override. Undefined means "fall back to CB (MC blue)" — this preserves
   * the original default behavior for users who haven't set a theme.
   */
  masterColor?: string;
  separators?: StatusLineSeparators;
  widgets: StatusLineWidget[];
}

/** Severity level for a doctor finding — drives icon + colour in the UI. */
export type DoctorSeverity = "info" | "warn" | "error";

/** Status of a doctor finding after a check runs. */
export type DoctorStatus = "healthy" | "detected" | "fixed" | "unfixable" | "skipped";

/** A single check result produced by the profiles doctor. */
export interface DoctorFinding {
  /** Stable identifier for the check — used as a React key. */
  check: string;
  /** Human-readable one-line title. */
  title: string;
  severity: DoctorSeverity;
  status: DoctorStatus;
  /** Detailed explanation for the user. */
  detail: string;
  /** Specific items (profile names, alias names, dir names) the finding applies to. */
  itemsAffected?: string[];
  /** If the check took a backup before fixing, the path to that backup. */
  backupPath?: string;
}

/** Full report returned by runProfilesDoctor. */
export interface DoctorReport {
  /** ISO timestamp the report was generated. */
  ranAt: string;
  /** Whether this was a read-only detect run or a write-capable repair run. */
  mode: "detect" | "repair";
  findings: DoctorFinding[];
  summary: {
    total: number;
    healthy: number;
    detected: number;
    fixed: number;
    unfixable: number;
    skipped: number;
  };
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
  getAvailablePlugins: () => Promise<{ installed: InstalledPluginInfo[]; available: AvailablePlugin[] }>;
  installPlugin: (pluginId: string) => Promise<void>;
  addMarketplace: (source: string) => Promise<void>;
  removeMarketplace: (name: string) => Promise<void>;
  updateMarketplace: (name: string) => Promise<void>;
  updateAllMarketplaces: () => Promise<void>;
  listMarketplaces: () => Promise<Array<{ name: string; repo: string; lastUpdated: string }>>;
  getTeams: () => Promise<Team[]>;
  saveTeam: (team: Team) => Promise<Team>;
  deleteTeam: (name: string) => Promise<void>;
  renameTeam: (oldName: string, team: Team) => Promise<Team>;
  getTeamMergePreview: (team: Team) => Promise<MergePreview>;
  checkTeamHealth: () => Promise<Record<string, string[]>>;
  launchTeam: (team: Team, directory?: string) => Promise<void>;
  // Global settings
  getGlobalClaudeMd: () => Promise<string>;
  saveGlobalClaudeMd: (content: string) => Promise<void>;
  getPrompts: () => Promise<Prompt[]>;
  savePrompts: (prompts: Prompt[]) => Promise<void>;
  exportPrompt: (prompt: Prompt) => Promise<string | null>;
  importPrompt: () => Promise<Prompt | null>;
  checkCredentialStatus: () => Promise<{ global: boolean; profiles: Array<{ name: string; useDefaultAuth: boolean; hasCredentials: boolean }> }>;
  runDiagnostics: () => Promise<{ version: string; configDir: string; claudeHome: string; profileCount: number; teamCount: number; issues: string[] }>;
  runProfilesDoctor: (mode: "detect" | "repair") => Promise<DoctorReport>;
  getAppPreferences: () => Promise<{ fontSize: number; theme?: string }>;
  saveAppPreferences: (prefs: { fontSize: number; theme?: string }) => Promise<void>;
  getGlobalEnv: () => Promise<Record<string, string>>;
  saveGlobalEnv: (env: Record<string, string>) => Promise<void>;
  getGlobalHooks: () => Promise<Record<string, any>>;
  saveGlobalHooks: (hooks: Record<string, any>) => Promise<void>;
  getGlobalDefaults: () => Promise<{ model: string; opusContext?: "200k" | "1m"; sonnetContext?: "200k" | "1m"; effortLevel: string; env?: Record<string, string>; customFlags?: string; terminalApp?: string; tmuxMode?: string }>;
  saveGlobalDefaults: (defaults: { model: string; opusContext?: "200k" | "1m"; sonnetContext?: "200k" | "1m"; effortLevel: string; env?: Record<string, string>; customFlags?: string; terminalApp?: string; tmuxMode?: string }) => Promise<void>;
  checkTmuxInstalled: () => Promise<boolean>;
  launchProfileWithOptions: (name: string, directory?: string, options?: LaunchOptions) => Promise<void>;
  launchTeamWithOptions: (team: Team, directory?: string, options?: LaunchOptions) => Promise<void>;
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
  revealInFinder: (path: string) => Promise<void>;
  openExternalUrl: (url: string) => Promise<void>;
  getProfileConfigDir: (name: string) => Promise<string>;
  getClaudeHome: () => Promise<string>;
  getAnalytics: (since?: number, project?: string) => Promise<AnalyticsData>;
  getActiveSessions: () => Promise<ActiveSession[]>;
  checkForAppUpdate: () => Promise<{ available: boolean; current: string; latest: string }>;
  getCuratedMarketplace: () => Promise<CuratedMarketplaceData>;
  refreshCuratedMarketplace: () => Promise<CuratedMarketplaceData>;
  getCuratedIndex: () => Promise<CuratedIndex>;
  refreshCuratedIndex: () => Promise<CuratedIndex>;
  fetchUpstreamMarketplace: (source: string) => Promise<Record<string, any>>;
  fetchPluginItems: (source: string, pluginPath: string) => Promise<PluginItem[]>;
  fetchRepoReadme: (source: string) => Promise<string>;
  getGitHubBackend: () => Promise<{
    kind: "gh" | "fetch-authed" | "fetch-anon";
    rateLimit: "5000/h" | "60/h";
    description: string;
    upgradeHint: string | null;
  }>;
  // Status line config
  getStatusLineConfig: () => Promise<StatusLineConfig>;
  setStatusLineConfig: (config: StatusLineConfig) => Promise<void>;
  resetStatusLineConfig: () => Promise<StatusLineConfig>;
  renderStatusLinePreview: (config: StatusLineConfig, mockSession?: Record<string, unknown>) => Promise<string>;
  // Plugin resolver
  resolvePlugins: (ids: string[]) => Promise<Array<{ id: string; resolved: ResolvedPlugin | null }>>;
  // Known env vars
  getKnownEnvVars: () => Promise<KnownEnvVar[]>;
  getFavouritePlugins: () => Promise<string[]>;
  saveFavouritePlugins: (ids: string[]) => Promise<void>;
}

export interface ActiveSession {
  profile: string;
  pid: number;
  sessionId: string;
  cwd: string;
  startedAt: number;
}

export interface AnalyticsData {
  totalSessions: number;
  totalMessages: number;
  dailyActivity: Array<{ date: string; messages: number }>;
  topProjects: Array<{ name: string; messages: number }>;
  profileUsage: Array<{ name: string; sessions: number; messages: number }>;
  recentSessions: Array<{ project: string; directory?: string; date: string; messages: number; sessionId: string; profile?: string; type?: string }>;
}

declare global {
  interface Window {
    api: ElectronAPI;
  }
}
