import * as fs from "fs";
import * as path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import type { PluginItem, CuratedMarketplaceData, CuratedIndex } from "./types";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Curated marketplace
// ---------------------------------------------------------------------------

let curatedCache: CuratedMarketplaceData | null = null;
let curatedIndexCache: CuratedIndex | null = null;

// ---------------------------------------------------------------------------
// GitHub API backend
// ---------------------------------------------------------------------------
//
// Three-level backend detection, picked once at first use and cached for the
// session:
//
//   1. `gh` CLI authenticated → use `gh api`. 5000/h quota, access to any
//      private repo the user has permissions for, multi-host support
//      (e.g. GitHub Enterprise).
//   2. `GITHUB_TOKEN` env var set → use fetch() with an Authorization header.
//      Same 5000/h quota, any private repo the token grants, no `gh` CLI
//      required.
//   3. Neither → fall back to unauthenticated fetch(). 60/h quota,
//      public repos only.
//
// Every GitHub call site goes through `githubApi(path, opts)`; the backend
// dispatch is invisible to callers. Detection runs once per session, so users
// who install/configure `gh` mid-session need to restart to pick it up.

type GitHubBackend =
  | { kind: "gh" }
  | { kind: "fetch-authed"; token: string }
  | { kind: "fetch-anon" };

let _ghBackend: GitHubBackend | null = null;
let _ghBinaryPathCache: string | null = null;

/**
 * Locate the `gh` CLI binary. Checks `GH_PATH` first (override), then common
 * install locations, then falls back to bare "gh" (which lets execFileAsync
 * try the runtime PATH — may still succeed in dev-mode Electron).
 *
 * Electron on macOS launched from a `.app` bundle inherits a minimal PATH
 * that usually excludes Homebrew locations, so hardcoding the bundle-safe
 * absolute path is more reliable than trusting PATH. Apple Silicon and Intel
 * Homebrew use different prefixes, hence the two-candidate check.
 */
function ghBinary(): string {
  if (_ghBinaryPathCache) return _ghBinaryPathCache;
  const override = process.env.GH_PATH;
  if (override) {
    _ghBinaryPathCache = override;
    return override;
  }
  const candidates = [
    "/opt/homebrew/bin/gh",    // macOS Apple Silicon Homebrew
    "/usr/local/bin/gh",       // macOS Intel Homebrew, Linux /usr/local
    "/usr/bin/gh",             // Linux system install
    "/home/linuxbrew/.linuxbrew/bin/gh", // Linuxbrew
  ];
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      _ghBinaryPathCache = c;
      return c;
    } catch {
      // try next
    }
  }
  // Fall back to bare name — execFileAsync will search PATH if the host
  // environment has it available (dev mode, most tests).
  _ghBinaryPathCache = "gh";
  return "gh";
}

async function detectGitHubBackend(): Promise<GitHubBackend> {
  if (_ghBackend) return _ghBackend;
  // Level 1: gh CLI authenticated. `gh auth status` exits 0 only when at
  // least one host is logged in; otherwise it errors. Bounded 3s timeout in
  // case gh is installed but hangs on a flaky config file.
  try {
    await execFileAsync(ghBinary(), ["auth", "status"], { timeout: 3000 });
    _ghBackend = { kind: "gh" };
    return _ghBackend;
  } catch {
    // fall through to fetch-based backends
  }
  // Level 2: GITHUB_TOKEN env var (authenticated fetch, no gh needed).
  const token = process.env.GITHUB_TOKEN?.trim();
  if (token) {
    _ghBackend = { kind: "fetch-authed", token };
    return _ghBackend;
  }
  // Level 3: unauthenticated fetch. Public repos only, 60/h quota.
  _ghBackend = { kind: "fetch-anon" };
  return _ghBackend;
}

/**
 * Public backend state for the UI. Browse-tab callers can use this to show a
 * quota/limits banner explaining what mode the app is running in and how to
 * raise the rate limit.
 */
export async function getGitHubBackendState(): Promise<{
  kind: "gh" | "fetch-authed" | "fetch-anon";
  rateLimit: "5000/h" | "60/h";
  description: string;
  upgradeHint: string | null;
}> {
  const b = await detectGitHubBackend();
  switch (b.kind) {
    case "gh":
      return {
        kind: "gh",
        rateLimit: "5000/h",
        description: "Authenticated via `gh` CLI",
        upgradeHint: null,
      };
    case "fetch-authed":
      return {
        kind: "fetch-authed",
        rateLimit: "5000/h",
        description: "Authenticated via GITHUB_TOKEN env var",
        upgradeHint: null,
      };
    case "fetch-anon":
      return {
        kind: "fetch-anon",
        rateLimit: "60/h",
        description: "Unauthenticated — public repos only",
        upgradeHint: "Install `gh` CLI (https://cli.github.com) and run `gh auth login`, or set GITHUB_TOKEN in your environment, to raise the limit to 5000/h and access private marketplaces.",
      };
  }
}

/**
 * Unified GitHub API helper. Routes through whichever backend was detected
 * at startup; callers never have to know which one.
 *
 * Raw vs JSON media:
 *   - `raw: true` → `application/vnd.github.raw`. Use for file-content fetches
 *     (marketplace.json, SKILL.md, plugin.json, README, index.json). Avoids
 *     the JSON contents endpoint's 1 MB limit and skips base64 encoding.
 *   - `raw: false` (default) → `application/vnd.github+json`. Use for
 *     directory listings and symlink detection (where the `type` / `target`
 *     fields are needed).
 *
 * 50 MB `maxBuffer` on the `gh` path prevents Node's 1 MB child-process
 * default from silently truncating large payloads — this previously broke
 * index.json fetching once the search index grew past the 1 MB default.
 */
async function githubApi(
  apiPath: string,
  opts: { raw?: boolean; timeout?: number } = {},
): Promise<string> {
  const backend = await detectGitHubBackend();
  const timeout = opts.timeout ?? 15000;
  const accept = opts.raw ? "application/vnd.github.raw" : "application/vnd.github+json";

  if (backend.kind === "gh") {
    const { stdout } = await execFileAsync(ghBinary(), [
      "api",
      apiPath,
      "-H", `Accept: ${accept}`,
    ], { timeout, maxBuffer: 50 * 1024 * 1024 });
    return stdout;
  }

  // fetch-authed and fetch-anon share the fetch path; the only difference is
  // whether we attach an Authorization header.
  const url = `https://api.github.com/${apiPath.replace(/^\//, "")}`;
  const headers: Record<string, string> = {
    "User-Agent": "claude-profiles",
    "Accept": accept,
  };
  if (backend.kind === "fetch-authed") {
    headers["Authorization"] = `token ${backend.token}`;
  }
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} on ${apiPath}: ${res.statusText}`);
  }
  return await res.text();
}

// ---------------------------------------------------------------------------
// LRU caches for quota-sensitive call sites
// ---------------------------------------------------------------------------
//
// `fetchRepoReadme` and `fetchUpstreamMarketplace` are called from the curated
// detail modal every time it opens. Without caching, repeat opens cost one
// round-trip each — under the `fetch-anon` backend (60/h quota) that adds up
// fast for anyone casually browsing. Both are idempotent for the life of a
// session; a restart refreshes. Map-based LRU is sufficient.
const README_CACHE_MAX = 50;
const MARKETPLACE_CACHE_MAX = 50;
const _readmeCache = new Map<string, string>();
const _marketplaceCache = new Map<string, Record<string, any>>();

function lruTouch<K, V>(cache: Map<K, V>, key: K, val: V, max: number): void {
  cache.delete(key);
  cache.set(key, val);
  if (cache.size > max) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

/** Fetches a file from the curator's own marketplace repo. */
async function fetchGitHubFileContent(repoPath: string): Promise<string> {
  return githubApi(
    `repos/Mduffy37/claude-profiles-marketplace/contents/${repoPath}`,
    { raw: true },
  );
}

/** Fetch a raw file from any public GitHub repo. */
async function fetchAnyRepoFile(source: string, filePath: string): Promise<string> {
  return githubApi(`repos/${source}/contents/${filePath}`, { raw: true });
}

/**
 * Resolve a relative symlink target against the symlink's own location.
 * Pure path math — no network. Returns null if the target escapes repo root.
 */
function resolveSymlinkTargetPath(symlinkPath: string, target: string): string | null {
  const parentDir = path.posix.dirname(symlinkPath);
  const joined = path.posix.join(parentDir, target);
  const normalised = path.posix.normalize(joined);
  if (
    normalised.startsWith("..") ||
    normalised.startsWith("/") ||
    normalised === "" ||
    normalised === "."
  ) {
    return null;
  }
  return normalised;
}

/**
 * Chase a path through any symlinks via the GitHub contents API (JSON form).
 * Returns the final non-symlink path, or null if broken/looping/escaping.
 * Depth-capped at 3. If the input is not a symlink, returns it unchanged.
 *
 * GitHub's contents API does not follow symlinks server-side: fetching a path
 * that traverses an intermediate symlink returns 404, and fetching a symlink
 * blob directly returns `{type: "symlink", target: ...}`. This helper is the
 * client-side workaround — without it, any plugin that cross-publishes via
 * symlinks (e.g. redis/agent-skills) enumerates as empty.
 */
async function resolveSymlink(source: string, repoPath: string, depth = 0): Promise<string | null> {
  if (depth >= 3) return null;
  const cleanPath = repoPath.replace(/^\/+/, "");
  try {
    const stdout = await githubApi(`repos/${source}/contents/${cleanPath}`);
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed)) return cleanPath;
    if (parsed && parsed.type === "symlink" && typeof parsed.target === "string") {
      const resolved = resolveSymlinkTargetPath(cleanPath, parsed.target);
      if (!resolved) return null;
      return resolveSymlink(source, resolved, depth + 1);
    }
    return cleanPath;
  } catch {
    return null;
  }
}

/**
 * List a directory's contents in any public GitHub repo. Returns entries with name/type/path.
 * Transparently follows the case where `dirPath` is itself a symlink to another directory
 * (depth-capped at 3). Symlink *children* inside the listing are returned as-is with
 * type === "symlink" — callers that want to descend must call resolveSymlink on them.
 */
async function fetchAnyRepoDir(source: string, dirPath: string, depth = 0): Promise<Array<{ name: string; type: string; path: string }>> {
  if (depth >= 3) return [];
  const stdout = await githubApi(`repos/${source}/contents/${dirPath}`);
  const data = JSON.parse(stdout);
  if (!Array.isArray(data)) {
    if (data && data.type === "symlink" && typeof data.target === "string") {
      const resolved = resolveSymlinkTargetPath(dirPath.replace(/^\/+/, ""), data.target);
      if (!resolved) return [];
      return fetchAnyRepoDir(source, resolved, depth + 1);
    }
    return [];
  }
  return data.map((e: any) => ({ name: e.name, type: e.type, path: e.path }));
}

/** Content-based frontmatter parser — mirrors readFrontmatter() but takes a string instead of a file path. */
function parseFrontmatterString(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const lines = content.split("\n");
  if (!lines[0] || lines[0].trim() !== "---") return result;

  let currentKey: string | null = null;
  let multilineValue: string[] = [];

  const flushMultiline = () => {
    if (currentKey && multilineValue.length > 0) {
      result[currentKey] = multilineValue.join(" ").trim();
    }
    currentKey = null;
    multilineValue = [];
  };

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") { flushMultiline(); break; }
    if (currentKey && lines[i].length > 0 && (lines[i][0] === " " || lines[i][0] === "\t")) {
      multilineValue.push(lines[i].trim());
      continue;
    }
    flushMultiline();
    const colonIdx = lines[i].indexOf(":");
    if (colonIdx !== -1) {
      const key = lines[i].slice(0, colonIdx).trim();
      const value = lines[i].slice(colonIdx + 1).trim();
      if (value === ">" || value === "|" || value === ">-" || value === "|-") {
        currentKey = key;
        multilineValue = [];
      } else {
        result[key] = value.replace(/^["']|["']$/g, "");
      }
    }
  }
  return result;
}

/**
 * Fetch a repo's README as raw markdown. Cached per-source (see LRU notes
 * above) so the curated detail modal can be reopened without re-fetching.
 * Returns empty string on failure.
 *
 * We fetch `/readme` with `Accept: application/vnd.github.raw` which returns
 * the markdown directly — much simpler than the old `--jq ".content"` + base64
 * decode dance, and works identically on the `gh` and fetch backends.
 */
export async function fetchRepoReadme(source: string): Promise<string> {
  const cached = _readmeCache.get(source);
  if (cached !== undefined) {
    lruTouch(_readmeCache, source, cached, README_CACHE_MAX);
    return cached;
  }
  try {
    const raw = await githubApi(`repos/${source}/readme`, { raw: true });
    lruTouch(_readmeCache, source, raw, README_CACHE_MAX);
    return raw;
  } catch {
    return "";
  }
}

/**
 * Fetch an upstream Claude Code marketplace's manifest from GitHub without
 * registering it. Returns the parsed `.claude-plugin/marketplace.json` —
 * callers get the full upstream shape (typically `{ name, owner, plugins: [...] }`).
 * Cached per-source (see LRU notes above).
 */
export async function fetchUpstreamMarketplace(source: string): Promise<Record<string, any>> {
  const cached = _marketplaceCache.get(source);
  if (cached !== undefined) {
    lruTouch(_marketplaceCache, source, cached, MARKETPLACE_CACHE_MAX);
    return cached;
  }
  const raw = await fetchAnyRepoFile(source, ".claude-plugin/marketplace.json");
  const parsed = JSON.parse(raw);
  lruTouch(_marketplaceCache, source, parsed, MARKETPLACE_CACHE_MAX);
  return parsed;
}

/**
 * Fetch the list of skills/commands/agents inside a plugin without installing it.
 * Mirrors the logic in scanPluginItems() for local plugins:
 *   1. If `.claude-plugin/plugin.json` declares skills/commands/agents arrays, use those paths
 *      (the spec says manifest paths REPLACE conventional directories).
 *   2. Otherwise fall back to listing conventional `skills/`, `commands/`, `agents/` dirs.
 * For each item file, fetches its contents and parses frontmatter for name/description.
 *
 * `pluginPath` is the plugin's path within the repo (as declared in the upstream marketplace's
 * `plugins[].source` field — typically a relative path like `./` or `plugins/my-plugin`).
 */
export async function fetchPluginItems(source: string, pluginPath: string): Promise<PluginItem[]> {
  const items: PluginItem[] = [];
  // Normalise a path to have no leading "./" or leading/trailing slashes.
  const normalise = (p: string) => p.replace(/^\.\//, "").replace(/^\/+|\/+$/g, "");
  const basePath = normalise(pluginPath);
  // Join parts, normalising each, so "./" + "SKILL.md" doesn't become "//SKILL.md".
  const joinPath = (...parts: string[]) => parts.map(normalise).filter(Boolean).join("/");

  // plugin.json can declare each item type as:
  //   - an array of paths (the documented form)
  //   - a single string path (shorthand when there's only one)
  //   - missing entirely (fall back to conventional subdir)
  // Normalise string → [string] so the downstream loop is uniform.
  const asArray = (v: any): string[] | null => {
    if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
    if (typeof v === "string") return [v];
    return null;
  };

  // Attempt to read plugin.json manifest
  let manifest: Record<string, any> | null = null;
  try {
    const manifestRaw = await fetchAnyRepoFile(source, joinPath(basePath, ".claude-plugin", "plugin.json"));
    manifest = JSON.parse(manifestRaw);
  } catch {
    manifest = null;
  }

  const pluginDisplayName = manifest?.name ?? basePath ?? "unknown";

  const buildItem = async (itemPath: string, type: "skill" | "command" | "agent", fallbackName: string): Promise<PluginItem | null> => {
    try {
      const content = await fetchAnyRepoFile(source, itemPath);
      const fm = parseFrontmatterString(content);
      return {
        name: fm.name ?? fallbackName,
        description: (fm.description ?? "").replace(/\s+/g, " ").trim().slice(0, 500),
        type,
        plugin: pluginDisplayName,
        path: itemPath,
        userInvocable: type === "skill" ? (fm["user-invocable"] ?? "true").toLowerCase() !== "false" : true,
        dependencies: [],
      };
    } catch {
      return null;
    }
  };

  // Helper: resolve a manifest-declared SKILL entry into an array of items.
  // Mirrors resolveSkillManifestEntry on the local side: a directory entry
  // can resolve to multiple skills (one per subdirectory with SKILL.md) OR
  // a single skill (the directory itself has SKILL.md). Prefer subdirectories
  // when both are present.
  const resolveSkillEntry = async (entry: string): Promise<PluginItem[]> => {
    const cleaned = normalise(entry);
    const full = cleaned ? joinPath(basePath, cleaned) : basePath;
    // Entry points directly at a .md file — single skill.
    if (full.endsWith(".md")) {
      const fallbackName = full.split("/").pop()?.replace(/\.md$/, "") ?? "unknown";
      const item = await buildItem(full, "skill", fallbackName);
      return item ? [item] : [];
    }
    // Entry points at a directory. Enumerate children and look for skill subdirs.
    let children: Array<{ name: string; type: string; path: string }> = [];
    try {
      children = await fetchAnyRepoDir(source, full);
    } catch {
      return [];
    }
    const subdirResults: PluginItem[] = [];
    for (const child of children) {
      let effectiveDir: string | null = null;
      if (child.type === "dir") {
        effectiveDir = child.path;
      } else if (child.type === "symlink") {
        effectiveDir = await resolveSymlink(source, child.path);
        if (!effectiveDir) continue;
      } else {
        continue;
      }
      const childSkillMd = joinPath(effectiveDir, "SKILL.md");
      // child.name preserves the symlink's own display name even when content comes from elsewhere.
      const item = await buildItem(childSkillMd, "skill", child.name);
      if (item) subdirResults.push(item);
    }
    if (subdirResults.length > 0) return subdirResults;
    // No skill subdirectories — fall back to treating the directory itself as a skill.
    const directSkillMd = joinPath(full, "SKILL.md");
    const lastSegment = (cleaned ? cleaned : basePath).split("/").filter(Boolean).pop() ?? "unknown";
    const directItem = await buildItem(directSkillMd, "skill", lastSegment);
    return directItem ? [directItem] : [];
  };

  // Helper: resolve a manifest-declared command/agent entry into a single item (or null).
  const resolveSingleFileEntry = async (entry: string, type: "command" | "agent"): Promise<PluginItem | null> => {
    const cleaned = normalise(entry);
    const full = cleaned ? joinPath(basePath, cleaned) : basePath;
    if (!full.endsWith(".md")) return null;
    const fallbackName = full.split("/").pop()?.replace(/\.md$/, "") ?? "unknown";
    return buildItem(full, type, fallbackName);
  };

  // Helper: enumerate a conventional directory (skills/, commands/, agents/) and fetch items
  const enumerateConventionalDir = async (subdir: string, type: "skill" | "command" | "agent"): Promise<PluginItem[]> => {
    const dirPath = joinPath(basePath, subdir);
    let entries: Array<{ name: string; type: string; path: string }> = [];
    try {
      entries = await fetchAnyRepoDir(source, dirPath);
    } catch {
      return [];
    }
    const result: PluginItem[] = [];
    for (const e of entries) {
      if (type === "skill") {
        let effectiveDir: string | null = null;
        if (e.type === "dir") {
          effectiveDir = e.path;
        } else if (e.type === "symlink") {
          effectiveDir = await resolveSymlink(source, e.path);
          if (!effectiveDir) continue;
        } else {
          continue;
        }
        const skillMd = joinPath(effectiveDir, "SKILL.md");
        const item = await buildItem(skillMd, "skill", e.name);
        if (item) result.push(item);
      } else {
        if (!e.name.endsWith(".md") || e.name === "README.md") continue;
        let effectiveFile: string | null = null;
        if (e.type === "file") {
          effectiveFile = e.path;
        } else if (e.type === "symlink") {
          effectiveFile = await resolveSymlink(source, e.path);
          if (!effectiveFile) continue;
        } else {
          continue;
        }
        const item = await buildItem(effectiveFile, type, e.name.replace(/\.md$/, ""));
        if (item) result.push(item);
      }
    }
    return result;
  };

  const skillsDecl = manifest ? asArray(manifest.skills) : null;
  const commandsDecl = manifest ? asArray(manifest.commands) : null;
  const agentsDecl = manifest ? asArray(manifest.agents) : null;

  if (skillsDecl) {
    const seenPaths = new Set<string>();
    for (const entry of skillsDecl) {
      const resolved = await resolveSkillEntry(entry);
      for (const item of resolved) {
        if (seenPaths.has(item.path)) continue;
        seenPaths.add(item.path);
        items.push(item);
      }
    }
  } else {
    items.push(...(await enumerateConventionalDir("skills", "skill")));
  }
  if (commandsDecl) {
    for (const entry of commandsDecl) {
      const item = await resolveSingleFileEntry(entry, "command");
      if (item) items.push(item);
    }
  } else {
    items.push(...(await enumerateConventionalDir("commands", "command")));
  }
  if (agentsDecl) {
    for (const entry of agentsDecl) {
      const item = await resolveSingleFileEntry(entry, "agent");
      if (item) items.push(item);
    }
  } else {
    items.push(...(await enumerateConventionalDir("agents", "agent")));
  }

  return items;
}

export async function getCuratedMarketplace(): Promise<CuratedMarketplaceData> {
  if (curatedCache) return curatedCache;
  return refreshCuratedMarketplace();
}

export async function refreshCuratedMarketplace(): Promise<CuratedMarketplaceData> {
  try {
    const [marketplaceJson, collectionsJson] = await Promise.all([
      fetchGitHubFileContent("marketplace.json"),
      fetchGitHubFileContent("collections.json"),
    ]);
    const marketplaceData = JSON.parse(marketplaceJson);
    const collectionsData = JSON.parse(collectionsJson);
    curatedCache = {
      // v2 schema has both marketplaces[] and plugins[]; v1 has only plugins[].
      // Missing arrays default to empty so both shapes work without branching.
      marketplaces: marketplaceData.marketplaces ?? [],
      plugins: marketplaceData.plugins ?? [],
      collections: collectionsData.collections ?? [],
    };
    return curatedCache;
  } catch (err: any) {
    console.error("Failed to fetch curated marketplace:", err?.message);
    return { marketplaces: [], plugins: [], collections: [] };
  }
}

/**
 * Fetch the curated search index — a pre-built flat list of every curated
 * marketplace, plugin, skill, command, and agent. Generated by the curator repo's
 * scripts/build-index.js and committed as index.json. Enables global in-app search
 * without hitting GitHub on every keystroke.
 */
export async function getCuratedIndex(): Promise<CuratedIndex> {
  if (curatedIndexCache) return curatedIndexCache;
  return refreshCuratedIndex();
}

export async function refreshCuratedIndex(): Promise<CuratedIndex> {
  try {
    const raw = await fetchGitHubFileContent("index.json");
    const data = JSON.parse(raw);
    curatedIndexCache = {
      version: data.version ?? 1,
      generatedAt: data.generatedAt ?? "",
      sourceCommit: data.sourceCommit,
      entries: Array.isArray(data.entries) ? data.entries : [],
    };
    return curatedIndexCache;
  } catch (err: any) {
    console.error("Failed to fetch curated index:", err?.message);
    return { version: 1, generatedAt: "", entries: [] };
  }
}
