import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execFile } from "child_process";
import { promisify } from "util";
import type { ActiveSession, AnalyticsData } from "./types";
import {
  getPluginsWithItems,
  checkAllProfileHealth,
  scanMcpServers,
  readPluginManifest,
  normaliseManifestPaths,
} from "./plugins";
import { getGitHubBackendState } from "./marketplace";
import { checkCredentialStatus } from "./keychain";
import { loadTeams } from "./teams";
import { getLaunchLog } from "./launch";
import { CLAUDE_HOME, PROFILES_DIR, getGlobalDefaults } from "./config";
import {
  loadProfiles,
  getGlobalHooks,
  listMarketplaces,
} from "./core";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Active & Recent Sessions
// ---------------------------------------------------------------------------

export function getActiveSessions(): ActiveSession[] {
  const sessions: ActiveSession[] = [];
  if (!fs.existsSync(PROFILES_DIR)) return sessions;

  for (const dir of fs.readdirSync(PROFILES_DIR)) {
    if (dir.startsWith("_team_")) continue;
    const sessDir = path.join(PROFILES_DIR, dir, "config", "sessions");
    if (!fs.existsSync(sessDir)) continue;

    for (const file of fs.readdirSync(sessDir)) {
      if (!file.endsWith(".json")) continue;
      try {
        const data = JSON.parse(fs.readFileSync(path.join(sessDir, file), "utf-8"));
        // Check if PID is still running
        try {
          process.kill(data.pid, 0); // signal 0 = just check existence
          sessions.push({
            profile: dir,
            pid: data.pid,
            sessionId: data.sessionId,
            cwd: data.cwd,
            startedAt: data.startedAt,
          });
        } catch {
          // PID not running — stale session file
        }
      } catch {}
    }
  }

  sessions.sort((a, b) => b.startedAt - a.startedAt);
  return sessions;
}

// ---------------------------------------------------------------------------
// Analytics
// ---------------------------------------------------------------------------

export function getAnalytics(since?: number, project?: string): AnalyticsData {
  // Launch log — app-launched sessions only
  let launches = getLaunchLog(since);
  if (project) {
    launches = launches.filter((l) => path.basename(l.directory) === project);
  }
  const totalSessions = launches.length;

  // Daily launch counts
  const dailyCounts = new Map<string, number>();
  const projectCounts = new Map<string, number>();
  const recentLaunches: AnalyticsData["recentSessions"] = [];

  for (const launch of launches) {
    const dateStr = new Date(launch.timestamp).toISOString().slice(0, 10);
    dailyCounts.set(dateStr, (dailyCounts.get(dateStr) ?? 0) + 1);

    const projName = path.basename(launch.directory);
    projectCounts.set(projName, (projectCounts.get(projName) ?? 0) + 1);

    recentLaunches.push({
      project: projName,
      directory: launch.directory,
      date: dateStr,
      messages: 0,
      sessionId: `${launch.timestamp}-${launch.name}`,
      profile: launch.name,
      type: launch.type,
    });
  }

  // Profile usage from history.jsonl — messages sent through app-launched profiles
  let totalMessages = 0;
  const profileUsage: AnalyticsData["profileUsage"] = [];
  const profileMsgsByDate = new Map<string, number>();
  const currentProfiles = new Set(loadProfiles().map((p) => p.name));

  if (fs.existsSync(PROFILES_DIR)) {
    for (const dir of fs.readdirSync(PROFILES_DIR)) {
      if (dir.startsWith("_team_") || !currentProfiles.has(dir)) continue;
      const histPath = path.join(PROFILES_DIR, dir, "config", "history.jsonl");
      if (!fs.existsSync(histPath)) continue;
      try {
        const lines = fs.readFileSync(histPath, "utf-8").split("\n").filter(Boolean);
        let profileMsgs = 0;
        const sessions = new Set<string>();
        for (const line of lines) {
          const entry = JSON.parse(line);
          if (since && entry.timestamp < since) continue;
          if (project && entry.project && path.basename(entry.project) !== project) continue;
          profileMsgs++;
          if (entry.sessionId) sessions.add(entry.sessionId);
          if (entry.timestamp) {
            const dateStr = new Date(entry.timestamp).toISOString().slice(0, 10);
            profileMsgsByDate.set(dateStr, (profileMsgsByDate.get(dateStr) ?? 0) + 1);
          }
          // Track project usage from message history
          if (entry.project) {
            const projName = path.basename(entry.project);
            projectCounts.set(projName, (projectCounts.get(projName) ?? 0) + 1);
          }
        }
        totalMessages += profileMsgs;
        if (profileMsgs > 0) {
          profileUsage.push({ name: dir, sessions: sessions.size, messages: profileMsgs });
        }
      } catch {
        continue;
      }
    }
  }
  profileUsage.sort((a, b) => b.messages - a.messages);

  // Use message counts for daily activity (more granular than launch counts)
  for (const [date, msgs] of profileMsgsByDate) {
    dailyCounts.set(date, msgs);
  }

  const dailyActivity = [...dailyCounts.entries()]
    .map(([date, messages]) => ({ date, messages }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const topProjects = [...projectCounts.entries()]
    .map(([name, messages]) => ({ name, messages }))
    .sort((a, b) => b.messages - a.messages)
    .slice(0, 10);

  recentLaunches.sort((a, b) => b.date.localeCompare(a.date));
  const recent = recentLaunches.slice(0, 15);

  return { totalSessions, totalMessages, dailyActivity, topProjects, profileUsage, recentSessions: recent };
}


// ---------------------------------------------------------------------------
// Diagnostics export
// ---------------------------------------------------------------------------

/**
 * Gather a diagnostic snapshot of the app state for bug report attachments.
 * Returns a plain JSON-serialisable object — no secrets, no env var values,
 * no customClaudeMd / workflow / tools content. Safe to attach to a GitHub
 * issue as a .json file.
 */
export async function exportDiagnostics(): Promise<Record<string, any>> {
  const profiles = loadProfiles();
  const teams = loadTeams();
  const plugins = getPluginsWithItems();
  const health = checkAllProfileHealth(profiles);
  const mcpServers = scanMcpServers();
  const launches = getLaunchLog();
  const globalDefaults = getGlobalDefaults();
  const marketplaces = listMarketplaces();
  const activeSessions = getActiveSessions();
  const globalHooks = getGlobalHooks();

  // GitHub backend — async
  let ghBackend: any = null;
  try { ghBackend = await getGitHubBackendState(); } catch {}

  // Credential status — async, can fail on keychain issues
  let credStatus: any = null;
  try { credStatus = await checkCredentialStatus(); } catch {}

  // Doctor findings — run detect mode for comprehensive checks
  let doctorFindings: any = null;
  try {
    const { runProfilesDoctor } = require("./doctor");
    const report = runProfilesDoctor("detect");
    doctorFindings = {
      summary: report.summary,
      issues: report.findings
        .filter((f: any) => f.status !== "healthy")
        .map((f: any) => ({ check: f.check, status: f.status, title: f.title, severity: f.severity })),
    };
  } catch {}

  // Per-profile assembly state — the detail needed to diagnose overlay,
  // container-pattern, and MCP toggle issues.
  const profileDetails = profiles.map((p) => {
    const configDir = path.join(PROFILES_DIR, p.name, "config");
    const cacheDir = path.join(configDir, "plugins", "cache");

    // Check assembly fingerprint state.
    const markerPath = path.join(configDir, ".assembly-fingerprint.json");
    let fingerprint: any = null;
    try {
      if (fs.existsSync(markerPath)) {
        const raw = JSON.parse(fs.readFileSync(markerPath, "utf-8"));
        fingerprint = { hash: raw.fingerprint?.slice(0, 16), ts: raw.ts ? new Date(raw.ts).toISOString() : null };
      }
    } catch {}

    // Per-plugin: is it overlayed or symlinked? Does it use the container pattern?
    const pluginStates: Record<string, any> = {};
    for (const pluginId of p.plugins) {
      const plugin = plugins.find((pl) => pl.name === pluginId);
      if (!plugin) { pluginStates[pluginId] = { status: "not-installed" }; continue; }

      const pluginCacheDir = path.join(cacheDir, plugin.marketplace, plugin.pluginName);
      let cacheState = "unknown";
      try {
        if (!fs.existsSync(pluginCacheDir)) {
          cacheState = "missing";
        } else if (fs.lstatSync(pluginCacheDir).isSymbolicLink()) {
          cacheState = "symlink";
        } else {
          cacheState = "overlay";
        }
      } catch {}

      // Check for container-pattern fix (skills/ dir created by our assembly).
      const versionDir = path.join(pluginCacheDir, plugin.version);
      let hasSkillsDir = false;
      let hasContainerPattern = false;
      try {
        hasSkillsDir = fs.existsSync(path.join(versionDir, "skills"));
        const manifest = readPluginManifest(plugin.installPath);
        if (manifest) {
          const skillsDecl = normaliseManifestPaths(manifest.skills);
          hasContainerPattern = !!(skillsDecl && skillsDecl.some((s: string) => s === "./" || s === "."));
        }
      } catch {}

      const excluded = p.excludedItems?.[pluginId] ?? [];
      pluginStates[pluginId] = {
        version: plugin.version,
        cacheState,
        excludedCount: excluded.length,
        containerPattern: hasContainerPattern,
        hasSkillsDir,
        itemCount: plugin.items.length,
      };
    }

    return {
      name: p.name,
      pluginCount: p.plugins.length,
      model: p.model ?? "default",
      effortLevel: p.effortLevel ?? "default",
      hasCustomClaudeMd: !!p.customClaudeMd,
      hasWorkflow: !!p.workflow,
      disabledMcpServers: p.disabledMcpServers ?? null,
      assemblyFingerprint: fingerprint,
      plugins: pluginStates,
      lastLaunched: p.lastLaunched ? new Date(p.lastLaunched).toISOString() : null,
    };
  });

  return {
    version: 3,
    exportedAt: new Date().toISOString(),

    environment: {
      appVersion: (() => { try { return require(path.join(__dirname, "..", "..", "package.json")).version; } catch { return "unknown"; } })(),
      electronVersion: process.versions.electron ?? "unknown",
      nodeVersion: process.versions.node ?? "unknown",
      os: `${os.platform()} ${os.release()}`,
      arch: os.arch(),
    },

    githubBackend: ghBackend ? {
      kind: ghBackend.kind,
      rateLimit: ghBackend.rateLimit,
    } : null,

    credentials: credStatus ? {
      hasDefaultEntry: credStatus.hasDefaultEntry,
      profileCount: credStatus.profileCount,
    } : null,

    globalDefaults: {
      model: globalDefaults.model || "default",
      effortLevel: globalDefaults.effortLevel || "default",
      terminalApp: globalDefaults.terminalApp ?? "terminal",
      hasGlobalEnv: !!globalDefaults.env && Object.keys(globalDefaults.env).length > 0,
      hasCustomFlags: !!globalDefaults.customFlags,
    },

    globalHooks: {
      eventCount: Object.keys(globalHooks).length,
      events: Object.keys(globalHooks),
    },

    profiles: profileDetails,

    teams: {
      count: teams.length,
      names: teams.map((t) => t.name),
    },

    plugins: {
      installedCount: plugins.length,
      marketplaces: [...new Set(plugins.map((p) => p.marketplace))].sort(),
      registeredMarketplaces: marketplaces.map((m) => ({
        name: m.name,
        repo: m.repo,
        lastUpdated: m.lastUpdated,
      })),
      list: plugins.map((p) => ({
        name: p.name,
        version: p.version,
        itemCount: p.items.length,
        mcpCount: p.mcpServers.length,
        hookCount: p.hooks.length,
        source: (p as any).source?.type ?? null,
      })),
    },

    mcpServers: {
      userServers: mcpServers.filter((m) => m.scope === "user").map((m) => m.name),
      projectServers: mcpServers.filter((m) => m.scope === "project").map((m) => ({
        name: m.name,
        project: m.projectPath?.split("/").pop() ?? null,
      })),
    },

    doctor: doctorFindings,
    healthIssues: Object.keys(health).length > 0 ? health : null,

    activeSessions: activeSessions.map((s) => ({
      profile: s.profile,
      pid: s.pid,
    })),

    recentLaunches: launches.slice(-10).reverse().map((l) => ({
      type: l.type,
      name: l.name,
      timestamp: new Date(l.timestamp).toISOString(),
    })),
  };
}

export function runDiagnostics(): {
  version: string;
  configDir: string;
  claudeHome: string;
  profileCount: number;
  teamCount: number;
  issues: string[];
} {
  const profiles = loadProfiles();
  const teams = loadTeams();
  const issues: string[] = [];

  // Check each profile's config dir
  for (const profile of profiles) {
    const configDir = path.join(PROFILES_DIR, profile.name, "config");
    if (!fs.existsSync(configDir)) {
      issues.push(`Profile "${profile.name}": config directory missing`);
      continue;
    }
    // Check key symlinks
    const claudeMdLink = path.join(configDir, "CLAUDE.md");
    if (fs.existsSync(claudeMdLink)) {
      try {
        const target = fs.readlinkSync(claudeMdLink);
        if (!fs.existsSync(target)) {
          issues.push(`Profile "${profile.name}": CLAUDE.md symlink broken → ${target}`);
        }
      } catch {}
    }
    const projectsLink = path.join(configDir, "projects");
    if (fs.existsSync(projectsLink)) {
      try {
        const target = fs.readlinkSync(projectsLink);
        if (!fs.existsSync(target)) {
          issues.push(`Profile "${profile.name}": projects symlink broken → ${target}`);
        }
      } catch {}
    }
    // Check settings.json exists
    if (!fs.existsSync(path.join(configDir, "settings.json"))) {
      issues.push(`Profile "${profile.name}": settings.json missing`);
    }
  }

  // Check global files
  if (!fs.existsSync(path.join(CLAUDE_HOME, "settings.json"))) {
    issues.push("Global settings.json missing");
  }
  if (!fs.existsSync(path.join(CLAUDE_HOME, ".claude.json")) && !fs.existsSync(path.join(os.homedir(), ".claude.json"))) {
    issues.push("~/.claude.json missing (auth may not work)");
  }

  const pkg = require("../../package.json");

  return {
    version: pkg.version ?? "unknown",
    configDir: PROFILES_DIR,
    claudeHome: CLAUDE_HOME,
    profileCount: profiles.length,
    teamCount: teams.length,
    issues,
  };
}

export async function checkForAppUpdate(): Promise<{ available: boolean; current: string; latest: string }> {
  const pkg = require("../../package.json");
  const current: string = pkg.version ?? "0.0.0";
  const repo = pkg.repository?.url?.replace(/.*github\.com\//, "").replace(/\.git$/, "") ?? "";

  if (!repo) return { available: false, current, latest: current };

  try {
    // Check GitHub releases API
    const { stdout } = await execFileAsync("curl", [
      "-s", "-f", `https://api.github.com/repos/${repo}/releases/latest`,
    ], { timeout: 10000 });

    const release = JSON.parse(stdout);
    const latest: string = release.tag_name?.replace(/^v/, "") ?? current;

    // Simple semver comparison
    const cParts = current.split(".").map(Number);
    const lParts = latest.split(".").map(Number);
    let available = false;
    for (let i = 0; i < 3; i++) {
      if ((lParts[i] ?? 0) > (cParts[i] ?? 0)) { available = true; break; }
      if ((lParts[i] ?? 0) < (cParts[i] ?? 0)) break;
    }

    return { available, current, latest };
  } catch {
    // No releases yet or network error — try git if available
    try {
      const appDir = path.resolve(__dirname, "../..");
      await execFileAsync("git", ["fetch", "--quiet"], { cwd: appDir, timeout: 10000 });
      const { stdout } = await execFileAsync("git", [
        "rev-list", "--count", "HEAD..origin/main",
      ], { cwd: appDir, timeout: 5000 });
      const behind = parseInt(stdout.trim(), 10) || 0;
      return { available: behind > 0, current, latest: behind > 0 ? `${behind} commits ahead` : current };
    } catch {
      return { available: false, current, latest: current };
    }
  }
}
