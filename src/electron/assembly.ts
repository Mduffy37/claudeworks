import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import { spawn } from "child_process";
import type { PluginEntry, Profile } from "./types";
import { CLAUDE_HOME, PROFILES_DIR, getGlobalDefaults } from "./config";
import {
  FRAMEWORK_PLUGIN_PREFIX,
  scanInstalledPlugins,
  scanPluginItems,
  scanUserLocalPlugins,
  readPluginManifest,
  normaliseManifestPaths,
  isLocalPlugin,
  isFrameworkPlugin,
  writeMcpConfig,
} from "./plugins";

// ---------------------------------------------------------------------------
// Profile assembly
// ---------------------------------------------------------------------------

// Resolve a model shorthand + context preference into an explicit Claude Code
// model ID. Writing explicit IDs (rather than the "opus"/"sonnet" shorthand)
// avoids Claude Code silently resolving the shorthand differently across
// sessions — which is what caused Opus to sometimes land in 1M context and
// sometimes not.
export function resolveModelId(
  model: string,
  opusContext: "200k" | "1m" | undefined,
  sonnetContext: "200k" | "1m" | undefined,
): string {
  if (model === "opus") {
    return opusContext === "200k" ? "claude-opus-4-6" : "claude-opus-4-6[1m]";
  }
  if (model === "sonnet") {
    return sonnetContext === "1m" ? "claude-sonnet-4-6[1m]" : "claude-sonnet-4-6";
  }
  if (model === "haiku") {
    return "claude-haiku-4-5-20251001";
  }
  // Unknown / already-explicit model ID — pass through unchanged.
  return model;
}

export function assembleProfile(profile: Profile, launchDirectory?: string): string {
  const configDir = path.join(PROFILES_DIR, profile.name, "config");

  // Create directory structure
  for (const sub of ["plugins/cache", "plugins/data", "plugins/marketplaces"]) {
    fs.mkdirSync(path.join(configDir, sub), { recursive: true });
  }

  // Clean stale GSD artifacts when framework:gsd is not enabled
  if (!profile.plugins.includes(`${FRAMEWORK_PLUGIN_PREFIX}gsd`)) {
    // Remove GSD agents
    const agentsDir = path.join(configDir, "agents");
    if (fs.existsSync(agentsDir)) {
      for (const f of fs.readdirSync(agentsDir)) {
        if (f.startsWith("gsd-")) {
          const full = path.join(agentsDir, f);
          try { fs.unlinkSync(full); } catch {}
        }
      }
    }
    // Remove GSD commands namespace
    const gsdCmdsDir = path.join(configDir, "commands", "gsd");
    if (fs.existsSync(gsdCmdsDir)) {
      fs.rmSync(gsdCmdsDir, { recursive: true });
    }
    // Remove GSD runtime dir
    const gsdRuntime = path.join(configDir, "get-shit-done");
    if (fs.existsSync(gsdRuntime)) {
      const stat = fs.lstatSync(gsdRuntime);
      if (stat.isSymbolicLink()) fs.unlinkSync(gsdRuntime);
      else fs.rmSync(gsdRuntime, { recursive: true });
    }
    // Remove GSD hooks
    const hooksDir = path.join(configDir, "hooks");
    if (fs.existsSync(hooksDir)) {
      for (const f of fs.readdirSync(hooksDir)) {
        if (f.startsWith("gsd-")) {
          const full = path.join(hooksDir, f);
          try { fs.unlinkSync(full); } catch {}
        }
      }
    }
  }

  // Read source manifest
  const sourceManifestPath = path.join(CLAUDE_HOME, "plugins", "installed_plugins.json");
  if (!fs.existsSync(sourceManifestPath)) {
    throw new Error("No plugins installed. Install at least one plugin in Claude Code before launching a profile.");
  }
  const manifest = JSON.parse(fs.readFileSync(sourceManifestPath, "utf-8"));

  // Filter to selected plugins
  const filteredPlugins: Record<string, any> = {};
  for (const [name, entries] of Object.entries(manifest.plugins ?? {})) {
    if (profile.plugins.includes(name)) {
      filteredPlugins[name] = entries;
    }
  }

  // Write filtered installed_plugins.json (debug plugin added after cache setup)
  const profileManifest = {
    version: manifest.version ?? 2,
    plugins: filteredPlugins,
  };
  fs.writeFileSync(
    path.join(configDir, "plugins", "installed_plugins.json"),
    JSON.stringify(profileManifest, null, 2)
  );

  // Build settings.json
  const sourceSettingsPath = path.join(CLAUDE_HOME, "settings.json");
  const source = fs.existsSync(sourceSettingsPath)
    ? JSON.parse(fs.readFileSync(sourceSettingsPath, "utf-8"))
    : {};

  // Start with safe keys from global settings
  const SAFE_KEYS = new Set(["env", "hooks", "statusLine", "voiceEnabled"]);
  const settings: Record<string, any> = {};
  for (const [k, v] of Object.entries(source)) {
    if (SAFE_KEYS.has(k)) settings[k] = v;
  }
  // Filter disabled hooks per-profile
  if (settings.hooks && profile.disabledHooks && Object.keys(profile.disabledHooks).length > 0) {
    const filtered: Record<string, any[]> = {};
    for (const [event, matchers] of Object.entries(settings.hooks as Record<string, any[]>)) {
      const disabledIndices = new Set(profile.disabledHooks[event] ?? []);
      if (disabledIndices.size === 0) {
        filtered[event] = matchers;
      } else {
        const kept = matchers.filter((_: any, i: number) => !disabledIndices.has(i));
        if (kept.length > 0) filtered[event] = kept;
      }
    }
    settings.hooks = Object.keys(filtered).length > 0 ? filtered : undefined;
  }

  // Strip GSD hooks if framework:gsd is not enabled
  if (!profile.plugins.includes(`${FRAMEWORK_PLUGIN_PREFIX}gsd`) && settings.hooks) {
    const stripped: Record<string, any[]> = {};
    for (const [event, matchers] of Object.entries(settings.hooks as Record<string, any[]>)) {
      const kept = matchers.filter((m: any) => {
        const hooks = m.hooks ?? [];
        const nonGsd = hooks.filter((h: any) => !String(h.command ?? "").includes("gsd-"));
        if (nonGsd.length === 0) return false;
        m.hooks = nonGsd;
        return true;
      });
      if (kept.length > 0) stripped[event] = kept;
    }
    settings.hooks = Object.keys(stripped).length > 0 ? stripped : undefined;
  }

  // Honour the user's plugin selection exactly — do NOT force-include the
  // built-in profiles-manager plugin here. When the user has disabled it via
  // the app toggle (i.e. removed it from `profile.plugins`), silently re-adding
  // it breaks the profile isolation the toggle promises.
  settings.enabledPlugins = Object.fromEntries(
    profile.plugins.map((name) => [name, true])
  );

  // Apply profile-specific overrides, falling back to global defaults
  const globalDefaults = getGlobalDefaults();
  if (profile.model) {
    settings.model = resolveModelId(profile.model, profile.opusContext, profile.sonnetContext);
  } else if (globalDefaults.model) {
    settings.model = resolveModelId(globalDefaults.model, globalDefaults.opusContext, globalDefaults.sonnetContext);
  }
  if (profile.effortLevel) {
    settings.effortLevel = profile.effortLevel;
  } else if (globalDefaults.effortLevel) {
    settings.effortLevel = globalDefaults.effortLevel;
  }
  if (profile.voiceEnabled !== undefined) {
    settings.voiceEnabled = profile.voiceEnabled;
  }
  // Apply global env defaults, then profile-specific overrides
  if (globalDefaults.env && Object.keys(globalDefaults.env).length > 0) {
    settings.env = { ...(settings.env ?? {}), ...globalDefaults.env };
  }
  if (profile.env) {
    settings.env = { ...(settings.env ?? {}), ...profile.env };
  }
  if (profile.statusLine !== undefined) {
    if (profile.statusLine === null) {
      delete settings.statusLine;
    } else {
      settings.statusLine = profile.statusLine;
    }
  }

  // Copy permissions — keep plugin MCP permissions, strip standalone MCP permissions
  const sourcePerms = source.permissions;
  if (sourcePerms) {
    const allowed: string[] = sourcePerms.allow ?? [];
    settings.permissions = {
      ...sourcePerms,
      allow: allowed.filter((t: string) => {
        if (!t.startsWith("mcp__")) return true;
        if (t.startsWith("mcp__plugin_")) return true;
        return false;
      }),
    };
  }

  fs.writeFileSync(
    path.join(configDir, "settings.json"),
    JSON.stringify(settings, null, 2) + "\n"
  );

  // Handle per-profile CLAUDE.md
  const claudeMdTarget = path.join(configDir, "CLAUDE.md");
  if (profile.customClaudeMd) {
    // Write profile-specific CLAUDE.md (includes global via symlink reference)
    const globalClaudeMd = path.join(CLAUDE_HOME, "CLAUDE.md");
    let content = "";
    if (fs.existsSync(globalClaudeMd)) {
      content = fs.readFileSync(globalClaudeMd, "utf-8") + "\n\n";
    }
    content += "# Profile: " + profile.name + "\n\n" + profile.customClaudeMd;
    // Remove existing file/symlink before writing
    try { fs.unlinkSync(claudeMdTarget); } catch {}
    fs.writeFileSync(claudeMdTarget, content);
  } else {
    // Remove stale custom file so symlinkShared can create the global symlink
    try { fs.unlinkSync(claudeMdTarget); } catch {}
  }

  // Handle per-profile /workflow command
  const workflowPath = path.join(configDir, "commands", "workflow.md");
  if (profile.workflow && profile.workflow.trim()) {
    fs.mkdirSync(path.dirname(workflowPath), { recursive: true });
    const frontmatter = `---\ndescription: Run this profile's predefined workflow\n---\n\n`;
    fs.writeFileSync(workflowPath, frontmatter + profile.workflow);
  } else {
    try { fs.unlinkSync(workflowPath); } catch {}
  }

  // Handle per-profile /tools command — a persistent tool-set reference the
  // user can invoke at any time to see what's in this profile and why.
  // Mirror of the workflow block above; different file, different field.
  const toolsPath = path.join(configDir, "commands", "tools.md");
  if (profile.tools && profile.tools.trim()) {
    fs.mkdirSync(path.dirname(toolsPath), { recursive: true });
    const frontmatter = `---\ndescription: Show all tools in this profile with rationale\n---\n\n`;
    fs.writeFileSync(toolsPath, frontmatter + profile.tools);
  } else {
    try { fs.unlinkSync(toolsPath); } catch {}
  }

  // Handle workflow variants (/workflow-{name} commands)
  const commandsDir = path.join(configDir, "commands");
  fs.mkdirSync(commandsDir, { recursive: true });

  // Write each variant, tracking what was actually written
  const writtenVariantFiles = new Set<string>();
  for (const variant of profile.workflows ?? []) {
    if (!variant.name || !variant.body?.trim()) continue;
    // Project-scoped: skip if launch directory doesn't match
    const effectiveDir = launchDirectory ?? profile.directory;
    if (variant.directory && effectiveDir && variant.directory !== effectiveDir) continue;
    const filename = `workflow-${variant.name}.md`;
    const variantPath = path.join(commandsDir, filename);
    const frontmatter = `---\ndescription: Run the ${variant.name} workflow\n---\n\n`;
    fs.writeFileSync(variantPath, frontmatter + variant.body);
    writtenVariantFiles.add(filename);
  }

  // Clean up: remove any workflow-*.md that wasn't written in this pass
  try {
    for (const file of fs.readdirSync(commandsDir)) {
      if (file.startsWith("workflow-") && file.endsWith(".md") && !writtenVariantFiles.has(file)) {
        try { fs.unlinkSync(path.join(commandsDir, file)); } catch {}
      }
    }
  } catch {}

  // Handle per-profile status line config override (Phase 6)
  // When set, the Python renderer picks this up via $CLAUDE_CONFIG_DIR and
  // uses it instead of the global ~/.claude/statusline-config.json.
  const profileStatuslineConfigPath = path.join(configDir, "statusline-config.json");
  if (profile.statusLineConfig) {
    fs.writeFileSync(
      profileStatuslineConfigPath,
      JSON.stringify(profile.statusLineConfig, null, 2) + "\n",
      "utf-8",
    );
  } else {
    try { fs.unlinkSync(profileStatuslineConfigPath); } catch {}
  }

  // Scan plugins once for cache setup and exclusions
  const installedPlugins = scanInstalledPlugins();

  // Fingerprint-guarded cache rebuild.
  //
  // symlinkSelectedCaches + applyExclusions are the expensive phases of
  // assembleProfile — on a profile with several excluded plugins they wipe
  // and rebuild the whole plugin cache tree every time (deep copy + targeted
  // delete). Most profile saves don't touch anything that invalidates the
  // rebuild (tag/description/model/launchDir edits), and launches never do,
  // so we hash the inputs the rebuild actually depends on and skip the block
  // when the hash matches the marker we wrote last time.
  const fingerprint = computeAssemblyFingerprint(profile, installedPlugins);
  const markerPath = path.join(configDir, ".assembly-fingerprint.json");
  const cacheDir = path.join(configDir, "plugins", "cache");
  let cacheStale = true;
  try {
    if (fs.existsSync(markerPath) && fs.existsSync(cacheDir)) {
      const stored = JSON.parse(fs.readFileSync(markerPath, "utf-8"));
      if (stored?.fingerprint === fingerprint) cacheStale = false;
    }
  } catch {
    // Unreadable marker — treat as stale and rebuild.
  }

  if (cacheStale) {
    // Symlink plugin caches
    symlinkSelectedCaches(profile, configDir, installedPlugins);

    // Apply skill-level exclusions
    applyExclusions(profile, configDir, installedPlugins);
  }

  // Rewrite installPath for plugins with exclusions so Claude Code reads the patched manifest
  if (profile.excludedItems && Object.keys(profile.excludedItems).length > 0) {
    const manifestPath = path.join(configDir, "plugins", "installed_plugins.json");
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      for (const [pluginName, entries] of Object.entries(manifest.plugins ?? {})) {
        if (!(profile.excludedItems[pluginName]?.length > 0)) continue;
        const plugin = installedPlugins.find((p) => p.name === pluginName);
        if (!plugin) continue;
        const copiedPath = path.join(configDir, "plugins", "cache", plugin.marketplace, plugin.pluginName, plugin.version);
        if (fs.existsSync(copiedPath)) {
          for (const entry of entries as any[]) {
            entry.installPath = copiedPath;
          }
        }
      }
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }
  }

  // Fix container-pattern plugins for ALL plugins in the profile (not just
  // excluded ones). Plugins declaring "skills": "./" have skills at their root
  // level instead of in a conventional skills/ subdirectory. Claude Code's
  // runtime only scans <installPath>/skills/ for skill discovery, so these
  // root-level skills are invisible. Fix: for each container-pattern plugin,
  // create a skills/ directory and symlink the skill subdirs into it, then
  // write a patched plugin.json without the "skills" field. For plugins with
  // exclusions, applyExclusions already handles this inside the overlay; this
  // step catches plugins WITHOUT exclusions where the cache is a plain symlink
  // chain to the global cache.
  fixContainerPatternPlugins(profile, configDir, installedPlugins);

  // Symlink shared resources
  symlinkShared(configDir, profile);

  // Clean up stale auto-skills from old system (commands/profiles/, commands/start-team.md, etc.)
  const staleAutoSkills = path.join(configDir, "commands", "profiles");
  if (fs.existsSync(staleAutoSkills)) fs.rmSync(staleAutoSkills, { recursive: true });

  // Ensure built-in plugin is installed in the global cache
  ensureBuiltinPlugin();

  // Generate baseline mcp.json for CLI alias usage.
  // Launch through the app regenerates this with the actual working directory.
  const baselineDir = profile.directory ?? os.homedir();
  writeMcpConfig(profile, baselineDir, configDir);

  // Persist fingerprint so the next assembly with identical cache-relevant
  // inputs can skip symlinkSelectedCaches + applyExclusions. Written last so
  // a failure anywhere above leaves the prior (still-valid) marker untouched.
  try {
    fs.writeFileSync(
      markerPath,
      JSON.stringify({ fingerprint, ts: Date.now() }, null, 2),
    );
  } catch {}

  return configDir;
}

/**
 * Hash of the inputs that determine whether the cache rebuild phase of
 * assembleProfile can be skipped. Covers the enabled plugin set, their
 * versions (so reinstalls/upgrades force a rebuild), and the per-plugin
 * exclusion list. Bump the `v` field when the assembly shape itself changes.
 */
function computeAssemblyFingerprint(profile: Profile, plugins: PluginEntry[]): string {
  const enabledWithVersions = profile.plugins
    .map((name) => {
      const p = plugins.find((pl) => pl.name === name);
      return [name, p?.version ?? "unknown"] as [string, string];
    })
    .sort(([a], [b]) => a.localeCompare(b));
  const excluded = Object.entries(profile.excludedItems ?? {})
    .filter(([, v]) => Array.isArray(v) && v.length > 0)
    .map(([k, v]) => [k, [...v].sort()] as [string, string[]])
    .sort(([a], [b]) => a.localeCompare(b));
  const payload = JSON.stringify({ v: 1, plugins: enabledWithVersions, excluded });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

export function symlinkSelectedCaches(profile: Profile, configDir: string, plugins: PluginEntry[]): void {
  const sourceCache = path.join(CLAUDE_HOME, "plugins", "cache");
  const targetCache = path.join(configDir, "plugins", "cache");

  // Move the old cache dir aside in one O(1) rename, then recreate it empty.
  // The slow `rm -rf` of the previous filtered-copy trees (~1.9s on a
  // plugin-heavy profile) runs in a detached background process so it never
  // blocks the assembly hot path. Detached + unref means the cleanup survives
  // even if the parent Electron process exits before it finishes.
  const pluginsParent = path.join(configDir, "plugins");
  if (fs.existsSync(targetCache)) {
    const trashDir = path.join(pluginsParent, `cache.trash.${Date.now()}.${process.pid}`);
    try {
      fs.renameSync(targetCache, trashDir);
      spawn("rm", ["-rf", trashDir], { detached: true, stdio: "ignore" }).unref();
    } catch {
      // Rename can fail if something holds the dir open. Fall back to
      // synchronous removal so assembly still produces a clean state.
      try { fs.rmSync(targetCache, { recursive: true, force: true }); } catch {}
    }
  }
  fs.mkdirSync(targetCache, { recursive: true });

  // Determine which marketplace dirs need symlinking
  const neededMarketplaces = new Set<string>();
  for (const p of plugins) {
    if (profile.plugins.includes(p.name)) {
      neededMarketplaces.add(p.marketplace);
    }
  }

  // Symlink marketplace directories
  for (const mp of neededMarketplaces) {
    const src = path.join(sourceCache, mp);
    const tgt = path.join(targetCache, mp);
    if (fs.existsSync(src) && !fs.existsSync(tgt)) {
      fs.symlinkSync(src, tgt);
    }
  }
}

function applyExclusions(profile: Profile, configDir: string, plugins: PluginEntry[]): void {
  if (!profile.excludedItems || Object.keys(profile.excludedItems).length === 0) return;
  for (const [pluginName, excludedNames] of Object.entries(profile.excludedItems)) {
    if (excludedNames.length === 0) continue;

    const plugin = plugins.find((p) => p.name === pluginName);
    if (!plugin) continue;

    const targetCache = path.join(configDir, "plugins", "cache");
    const marketplaceDir = path.join(targetCache, plugin.marketplace);
    if (!fs.existsSync(marketplaceDir)) continue;

    const stat = fs.lstatSync(marketplaceDir);
    if (stat.isSymbolicLink()) {
      // Replace marketplace symlink with a real directory containing
      // symlinks to each plugin within it
      const realMarketplace = fs.realpathSync(marketplaceDir);
      fs.unlinkSync(marketplaceDir);
      fs.mkdirSync(marketplaceDir, { recursive: true });

      for (const entry of fs.readdirSync(realMarketplace)) {
        const src = path.join(realMarketplace, entry);
        const tgt = path.join(marketplaceDir, entry);
        fs.symlinkSync(src, tgt);
      }
    }

    // Replace the specific plugin dir with a structured overlay.
    //
    // Previous approach: deep-clone the entire plugin tree via fs.cpSync +
    // COPYFILE_FICLONE, filtering out the excluded paths along the way. On
    // APFS the clones were reflinks so the data was free, but cpSync still
    // walked the whole source tree (readdir + stat per entry) and paid
    // filesystem metadata overhead per kept file. For a 13-plugin profile
    // where several plugins are multi-hundred-file bundles, this burned
    // 4-5 seconds on every save that invalidated the fingerprint.
    //
    // New approach: walk only the *ancestor chain* leading to each excluded
    // item, materialising real directories along that chain and symlinking
    // everything else (whole subtrees) back to the source. Cost scales with
    // the number of directories that contain exclusions, not the total file
    // count. A "1500 skills, want 5" bundle goes from seconds to ~5 symlink
    // ops plus a manifest rewrite.
    //
    // Structure of the result:
    //   pluginDir/
    //     <version>/                     — real dir (ancestor)
    //       .claude-plugin/              — real dir (ancestor — manifest patch)
    //         plugin.json → source       — symlink
    //         marketplace.json            — real, patched copy
    //         <other files> → source     — symlinks
    //       skills/                      — real dir if any skill excluded
    //         kept-skill → source/...    — symlink (whole subtree)
    //         (excluded-skill omitted)
    //       commands/                    — real dir if any command excluded
    //         kept.md → source/...       — symlink
    //         (excluded.md omitted)
    //       lib/ → source/lib/           — symlink (whole subtree, no exclusions)
    //       readme.md → source/readme.md — symlink
    const pluginDir = path.join(marketplaceDir, plugin.pluginName);
    if (!fs.existsSync(pluginDir)) continue;

    const pluginStat = fs.lstatSync(pluginDir);
    if (!pluginStat.isSymbolicLink()) continue;
    const realPluginDir = fs.realpathSync(pluginDir);
    fs.unlinkSync(pluginDir);

    // Resolve each excluded item to a path relative to realPluginDir.
    // Skills exclude the containing directory (SKILL.md's parent);
    // agents/commands exclude the single file at item.path.
    const items = scanPluginItems(plugin);
    // Resolve installPath through realpathSync so it uses the same prefix as
    // realPluginDir — without this, any symlink in the path chain (e.g. macOS
    // /tmp → /private/tmp) causes path.relative to produce a "../" traversal
    // instead of the expected single-segment version dir.
    let resolvedInstallPath = plugin.installPath;
    try { resolvedInstallPath = fs.realpathSync(plugin.installPath); } catch {}
    const versionRel = path.relative(realPluginDir, resolvedInstallPath);

    const excludedPaths = new Set<string>();
    const excludedAncestors = new Set<string>();
    const addAncestors = (rel: string) => {
      let anc = path.dirname(rel);
      while (anc && anc !== "." && anc !== path.sep) {
        excludedAncestors.add(anc);
        const next = path.dirname(anc);
        if (next === anc) break;
        anc = next;
      }
    };
    for (const item of items) {
      if (!excludedNames.includes(item.name)) continue;
      const excludeAbs = item.type === "skill" ? path.dirname(item.path) : item.path;
      // item.path is based on plugin.installPath which may contain unresolved
      // symlinks (e.g. /tmp → /private/tmp on macOS). Compute the path
      // relative to installPath (guaranteed same prefix), then anchor it to
      // realPluginDir via the resolved versionRel to stay in the right
      // namespace.
      const relToInstall = path.relative(plugin.installPath, excludeAbs);
      if (!relToInstall || relToInstall.startsWith("..") || path.isAbsolute(relToInstall)) continue;
      const rel = versionRel ? path.join(versionRel, relToInstall) : relToInstall;
      excludedPaths.add(rel);
      addAncestors(rel);
    }

    // Container-pattern fix: plugins declaring "skills": "./" rely on Claude
    // Code's scanner resolving "./" relative to installPath. But plugin.json
    // is a symlink in the overlay, and Claude Code may follow the symlink
    // and resolve "./" against the SOURCE directory instead — bypassing the
    // overlay entirely. Additionally, the source may ship a root-level
    // SKILL.md (an aggregation skill) that makes Claude Code treat the whole
    // plugin as a single skill.
    //
    // Fix: for container-pattern plugins, write a MODIFIED plugin.json (real
    // file, not a symlink) that replaces "skills": "./" with an explicit
    // list of only the kept skill directories. This forces Claude Code to
    // load exactly the skills that survived the exclusion filter, regardless
    // of how it resolves relative paths or handles root SKILL.md files.
    const pluginManifest = readPluginManifest(resolvedInstallPath);
    let isContainerPattern = false;
    if (pluginManifest) {
      const skillsDecl = normaliseManifestPaths(pluginManifest.skills);
      if (skillsDecl && skillsDecl.some((s: string) => s === "./" || s === ".")) {
        isContainerPattern = true;
        // Exclude the root SKILL.md (aggregation skill) from the overlay.
        const rootSkillMd = path.join(resolvedInstallPath, "SKILL.md");
        if (fs.existsSync(rootSkillMd)) {
          const rootSkillRel = versionRel ? path.join(versionRel, "SKILL.md") : "SKILL.md";
          excludedPaths.add(rootSkillRel);
        }
      }
    }

    // Always force-materialise the version dir + .claude-plugin so we can
    // shadow marketplace.json with a patched copy. Mark the file itself as
    // excluded (the overlay walker won't symlink it) and write it manually
    // after the walk.
    const claudePluginRel = versionRel
      ? path.join(versionRel, ".claude-plugin")
      : ".claude-plugin";
    const marketplaceRel = path.join(claudePluginRel, "marketplace.json");
    if (versionRel && !versionRel.startsWith("..")) {
      excludedAncestors.add(versionRel);
    }
    excludedAncestors.add(claudePluginRel);
    excludedPaths.add(marketplaceRel);

    overlayDir(realPluginDir, pluginDir, "", excludedPaths, excludedAncestors);

    // Write the patched marketplace.json at its overlay location.
    const sourceMarketplaceJson = path.join(realPluginDir, marketplaceRel);
    const targetMarketplaceJson = path.join(pluginDir, marketplaceRel);
    if (fs.existsSync(sourceMarketplaceJson)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(sourceMarketplaceJson, "utf-8"));
        for (const p of manifest.plugins ?? []) {
          for (const key of ["skills", "agents", "commands"]) {
            if (Array.isArray(p[key])) {
              p[key] = p[key].filter((itemPath: string) => {
                const itemName = itemPath.split("/").pop() ?? "";
                return !excludedNames.includes(itemName);
              });
            }
          }
        }
        fs.mkdirSync(path.dirname(targetMarketplaceJson), { recursive: true });
        fs.writeFileSync(targetMarketplaceJson, JSON.stringify(manifest, null, 2));
      } catch {}
    }

    // Container-pattern fix: plugins with "skills": "./" have skills at the
    // root level, not in a skills/ subdirectory. Claude Code's runtime only
    // supports conventional scanning (looks for <installPath>/skills/), so
    // these root-level skills are invisible to it. Fix: create a conventional
    // skills/ directory in the overlay and symlink the kept skills into it.
    // Also write a patched plugin.json without the "skills" field so Claude
    // Code falls through to conventional scanning instead of trying "./"
    // resolution (which follows the symlink back to the source).
    if (isContainerPattern) {
      const overlayVersionDir = path.join(pluginDir, versionRel || "");
      const skillsDir = path.join(overlayVersionDir, "skills");
      fs.mkdirSync(skillsDir, { recursive: true });

      // Find kept skill dirs in the overlay root and symlink them into skills/.
      for (const entry of fs.readdirSync(overlayVersionDir, { withFileTypes: true })) {
        if (entry.name.startsWith(".") || entry.name === "skills") continue;
        const entryPath = path.join(overlayVersionDir, entry.name);
        const isDir = entry.isDirectory() || (entry.isSymbolicLink() && (() => {
          try { return fs.statSync(entryPath).isDirectory(); } catch { return false; }
        })());
        if (!isDir) continue;
        if (fs.existsSync(path.join(entryPath, "SKILL.md"))) {
          const tgt = path.join(skillsDir, entry.name);
          if (!fs.existsSync(tgt)) {
            // Symlink to the SOURCE skill dir (not the overlay symlink) for
            // a clean resolution chain.
            const sourcePath = path.join(resolvedInstallPath, entry.name);
            fs.symlinkSync(sourcePath, tgt);
          }
        }
      }

      // Write a patched plugin.json without the "skills" field so Claude Code
      // falls through to conventional skills/ dir scanning.
      if (pluginManifest) {
        const patched = { ...pluginManifest };
        delete patched.skills;
        const targetPluginJson = path.join(overlayVersionDir, ".claude-plugin", "plugin.json");
        // Remove the symlink first if it exists.
        try { fs.unlinkSync(targetPluginJson); } catch {}
        fs.writeFileSync(targetPluginJson, JSON.stringify(patched, null, 2));
      }
    }
  }
}



/**
 * Fix container-pattern plugins that declare "skills": "./" but have no
 * conventional skills/ subdirectory. Claude Code only scans <installPath>/skills/
 * so these plugins load zero skills. For each such plugin, we:
 *   1. Break the version-dir symlink if needed (create a mini-overlay)
 *   2. Create a skills/ directory with symlinks to the kept skill subdirs
 *   3. Write a patched plugin.json without the "skills" field
 *
 * Skips plugins that already have a skills/ dir (conventional layout) or
 * that were already handled by applyExclusions (which builds a full overlay).
 */
function fixContainerPatternPlugins(
  profile: Profile,
  configDir: string,
  plugins: PluginEntry[],
): void {
  const excludedPlugins = new Set(Object.keys(profile.excludedItems ?? {}).filter(
    (k) => (profile.excludedItems?.[k]?.length ?? 0) > 0,
  ));

  for (const pluginName of profile.plugins) {
    // Skip plugins that have exclusions — applyExclusions handles those.
    if (excludedPlugins.has(pluginName)) continue;

    const plugin = plugins.find((p) => p.name === pluginName);
    if (!plugin) continue;

    // Read the plugin manifest to check for container pattern.
    const manifest = readPluginManifest(plugin.installPath);
    if (!manifest) continue;
    const skillsDecl = normaliseManifestPaths(manifest.skills);
    if (!skillsDecl || !skillsDecl.some((s: string) => s === "./" || s === ".")) continue;

    // Already has a conventional skills/ dir — nothing to fix.
    if (fs.existsSync(path.join(plugin.installPath, "skills"))) continue;

    // Locate the version dir inside the profile's cache.
    const cachePluginDir = path.join(
      configDir, "plugins", "cache",
      plugin.marketplace, plugin.pluginName,
    );
    if (!fs.existsSync(cachePluginDir)) continue;

    // The version dir might be a real dir (from a previous fix) or accessed
    // through the marketplace symlink. Resolve to the real source.
    const versionDir = path.join(cachePluginDir, plugin.version);
    let realVersionDir: string;
    try {
      realVersionDir = fs.realpathSync(versionDir);
    } catch {
      continue;
    }

    // If the version dir is inside the global cache (i.e. not already an
    // overlay), we need to break the symlink chain to create a writable layer.
    // Strategy: replace the plugin-level dir with a mini-overlay containing
    // just the version dir as a real directory with symlinked children.
    const cachePluginStat = fs.lstatSync(cachePluginDir);
    if (cachePluginStat.isSymbolicLink()) {
      // cachePluginDir is a symlink — we're inside a marketplace symlink chain.
      // Need to break the marketplace symlink first.
      const marketplaceDir = path.dirname(cachePluginDir);
      const marketplaceStat = fs.lstatSync(marketplaceDir);
      if (marketplaceStat.isSymbolicLink()) {
        const realMp = fs.realpathSync(marketplaceDir);
        fs.unlinkSync(marketplaceDir);
        fs.mkdirSync(marketplaceDir, { recursive: true });
        for (const child of fs.readdirSync(realMp)) {
          const tgt = path.join(marketplaceDir, child);
          if (!fs.existsSync(tgt)) fs.symlinkSync(path.join(realMp, child), tgt);
        }
      }
      // Now cachePluginDir is still a symlink inside the (now real) marketplace dir.
      // Replace it with a real dir.
      const realPluginDir = fs.realpathSync(cachePluginDir);
      fs.unlinkSync(cachePluginDir);
      fs.mkdirSync(cachePluginDir, { recursive: true });
      // Symlink the version dir and any siblings.
      for (const child of fs.readdirSync(realPluginDir)) {
        const tgt = path.join(cachePluginDir, child);
        if (!fs.existsSync(tgt)) fs.symlinkSync(path.join(realPluginDir, child), tgt);
      }
    }

    // Now break the version dir symlink into a real dir with per-child symlinks.
    const versionStat = fs.lstatSync(versionDir);
    if (versionStat.isSymbolicLink()) {
      const realVer = fs.realpathSync(versionDir);
      fs.unlinkSync(versionDir);
      fs.mkdirSync(versionDir, { recursive: true });
      for (const child of fs.readdirSync(realVer)) {
        // Skip the root SKILL.md (aggregation skill) for container-pattern plugins.
        if (child === "SKILL.md") continue;
        const tgt = path.join(versionDir, child);
        if (!fs.existsSync(tgt)) fs.symlinkSync(path.join(realVer, child), tgt);
      }
    }

    // Create the conventional skills/ directory.
    const skillsDir = path.join(versionDir, "skills");
    if (fs.existsSync(skillsDir)) continue; // already created (idempotent)
    fs.mkdirSync(skillsDir, { recursive: true });

    // Symlink skill subdirs into skills/.
    for (const entry of fs.readdirSync(versionDir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "skills") continue;
      const entryPath = path.join(versionDir, entry.name);
      const isDir = entry.isDirectory() || (entry.isSymbolicLink() && (() => {
        try { return fs.statSync(entryPath).isDirectory(); } catch { return false; }
      })());
      if (!isDir) continue;
      if (fs.existsSync(path.join(entryPath, "SKILL.md"))) {
        const tgt = path.join(skillsDir, entry.name);
        if (!fs.existsSync(tgt)) {
          fs.symlinkSync(path.join(realVersionDir, entry.name), tgt);
        }
      }
    }

    // Write a patched plugin.json without the "skills" field.
    const pluginJsonPath = path.join(versionDir, ".claude-plugin", "plugin.json");
    const pluginJsonStat = fs.lstatSync(pluginJsonPath);
    if (pluginJsonStat.isSymbolicLink()) {
      fs.unlinkSync(pluginJsonPath);
    }
    const patched = { ...manifest };
    delete patched.skills;
    fs.writeFileSync(pluginJsonPath, JSON.stringify(patched, null, 2));
  }
}

/**
 * Walk `srcDir`, materialising `dstDir` as a mix of real dirs (for paths that
 * lead to excluded items) and symlinks (for subtrees with no exclusions).
 *
 * - Paths in `excludedPaths` are omitted entirely.
 * - Paths in `excludedAncestors` are created as real directories and recursed
 *   into — one level deeper on the chain toward an excluded item.
 * - Everything else is symlinked directly to its source counterpart, which
 *   means whole unrelated subtrees stay shared with the global plugin cache.
 *
 * Cost: O(directories on the ancestor chain + immediate children of each
 * ancestor). For a plugin with ~2000 files where 3 skills are excluded,
 * that's roughly 15-50 filesystem operations instead of 2000+ clonefile
 * calls — typically 50-200× fewer syscalls than the previous approach.
 */
function overlayDir(
  srcDir: string,
  dstDir: string,
  relPrefix: string,
  excludedPaths: Set<string>,
  excludedAncestors: Set<string>,
): void {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcChild = path.join(srcDir, entry.name);
    const dstChild = path.join(dstDir, entry.name);
    const relChild = relPrefix ? path.join(relPrefix, entry.name) : entry.name;
    if (excludedPaths.has(relChild)) continue;
    if (excludedAncestors.has(relChild)) {
      overlayDir(srcChild, dstChild, relChild, excludedPaths, excludedAncestors);
      continue;
    }
    fs.symlinkSync(srcChild, dstChild);
  }
}

/**
 * Recursive directory copy that uses APFS clonefile reflinks on macOS via
 * `COPYFILE_FICLONE` — files become copy-on-write references to the source
 * inode instead of full data copies, so a multi-thousand-file plugin tree
 * clones in tens of milliseconds instead of multiple seconds. On non-APFS
 * filesystems the flag silently falls back to a normal copy, so this is
 * always at least as fast as the old file-by-file implementation.
 *
 * Used for both filtered plugin copies in applyExclusions and the builtin
 * plugin installer — both call paths are on the user's profile-assembly
 * hot path.
 */
function copyDirRecursive(src: string, dest: string): void {
  fs.cpSync(src, dest, {
    recursive: true,
    force: true,
    mode: fs.constants.COPYFILE_FICLONE,
  });
}

const BUILTIN_PLUGIN_NAME = "profiles-manager@claudeworks";
const BUILTIN_PLUGIN_VERSION = "1.0.0";


export function ensureBuiltinPlugin(): string {
  // Install the built-in profiles-manager plugin so it appears as a normal
  // marketplace plugin. Three things need to exist:
  //   1. Plugin files in the cache: ~/.claude/plugins/cache/claudeworks/profiles-manager/<version>/
  //   2. Marketplace manifest: ~/.claude/plugins/marketplaces/claudeworks/.claude-plugin/marketplace.json
  //   3. Entry in ~/.claude/plugins/known_marketplaces.json
  //   4. Entry in ~/.claude/plugins/installed_plugins.json
  const marketplaceRoot = path.join(CLAUDE_HOME, "plugins", "marketplaces", "claudeworks");
  const cacheDir = path.join(CLAUDE_HOME, "plugins", "cache", "claudeworks", "profiles-manager", BUILTIN_PLUGIN_VERSION);

  // Source: check dev path first, then production path
  const devPath = path.join(__dirname, "..", "..", "src", "builtin-plugin");
  const prodPath = path.join(__dirname, "..", "builtin-plugin");
  const src = fs.existsSync(devPath) ? devPath : prodPath;
  if (!fs.existsSync(src)) return cacheDir;

  const now = new Date().toISOString();

  // 1. Copy plugin files to cache (always overwrite to get latest)
  if (fs.existsSync(cacheDir)) fs.rmSync(cacheDir, { recursive: true });
  fs.mkdirSync(cacheDir, { recursive: true });
  copyDirRecursive(src, cacheDir);

  // 2. Create marketplace manifest with plugin source pointing to cache
  const pluginMetaDir = path.join(marketplaceRoot, ".claude-plugin");
  fs.mkdirSync(pluginMetaDir, { recursive: true });
  // Also put plugin files under marketplaces/ so Claude can resolve the source path
  const mktPluginDir = path.join(marketplaceRoot, "plugins", "profiles-manager");
  if (fs.existsSync(mktPluginDir)) fs.rmSync(mktPluginDir, { recursive: true });
  fs.mkdirSync(mktPluginDir, { recursive: true });
  copyDirRecursive(src, mktPluginDir);
  fs.writeFileSync(path.join(pluginMetaDir, "marketplace.json"), JSON.stringify({
    "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
    name: "claudeworks",
    description: "Built-in plugins for the ClaudeWorks app",
    owner: { name: "ClaudeWorks" },
    plugins: [{
      name: "profiles-manager",
      description: "Self-management skills — list add-ons, create profiles and teams, check status, discover plugins.",
      source: "./plugins/profiles-manager",
      category: "productivity",
    }],
  }, null, 2));

  // 3. Register in known_marketplaces.json
  const knownPath = path.join(CLAUDE_HOME, "plugins", "known_marketplaces.json");
  let known: any = {};
  if (fs.existsSync(knownPath)) {
    try { known = JSON.parse(fs.readFileSync(knownPath, "utf-8")); } catch {}
  }
  if (!known["claudeworks"] || known["claudeworks"].installLocation !== marketplaceRoot) {
    known["claudeworks"] = {
      source: { source: "directory", path: marketplaceRoot },
      installLocation: marketplaceRoot,
      lastUpdated: now,
    };
    fs.writeFileSync(knownPath, JSON.stringify(known, null, 2));
  }

  // 4. Register in installed_plugins.json
  const manifestPath = path.join(CLAUDE_HOME, "plugins", "installed_plugins.json");
  let manifest: any = { plugins: {} };
  if (fs.existsSync(manifestPath)) {
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")); } catch {}
  }
  if (!manifest.plugins[BUILTIN_PLUGIN_NAME]) {
    manifest.plugins[BUILTIN_PLUGIN_NAME] = [{
      scope: "user",
      installPath: cacheDir,
      version: BUILTIN_PLUGIN_VERSION,
      installedAt: now,
      lastUpdated: now,
    }];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  } else {
    const entry = manifest.plugins[BUILTIN_PLUGIN_NAME][0];
    if (entry.installPath !== cacheDir || entry.version !== BUILTIN_PLUGIN_VERSION) {
      entry.installPath = cacheDir;
      entry.version = BUILTIN_PLUGIN_VERSION;
      entry.lastUpdated = now;
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    }
  }

  return cacheDir;
}

export function symlinkShared(configDir: string, profile: Profile): void {
  // Copy ~/.claude.json into profile config dir to seed auth + onboarding state.
  // Claude Code reads $CLAUDE_CONFIG_DIR/.claude.json instead of ~/.claude.json
  // when CLAUDE_CONFIG_DIR is set. This is a copy (not symlink) because Claude
  // writes to this file during sessions.
  // Skip when useDefaultAuth is false — the user wants separate credentials.
  const homeClaudeJson = path.join(os.homedir(), ".claude.json");
  const profileClaudeJson = path.join(configDir, ".claude.json");
  if (profile.useDefaultAuth !== false) {
    // Always overwrite — the profile may have stale auth from a previous toggle-off
    if (fs.existsSync(homeClaudeJson)) {
      fs.copyFileSync(homeClaudeJson, profileClaudeJson);
    }
  } else {
    // Remove copied auth state so the profile gets its own credentials on next launch
    if (fs.existsSync(profileClaudeJson)) {
      fs.unlinkSync(profileClaudeJson);
    }
  }

  const shared: [string, string][] = [
    ["CLAUDE.md", "CLAUDE.md"],
    ["projects", "projects"],
  ];

  for (const [sourceName, targetName] of shared) {
    const src = path.join(CLAUDE_HOME, sourceName);
    const tgt = path.join(configDir, targetName);
    if (fs.existsSync(src) && !fs.existsSync(tgt)) {
      fs.symlinkSync(src, tgt);
    }
  }

  // Symlink user-level local add-ons and framework plugins.
  const enabledLocalOrFramework = profile.plugins.filter(
    (n) => isLocalPlugin(n) || isFrameworkPlugin(n)
  );
  if (enabledLocalOrFramework.length > 0) {
    const localPlugins = scanUserLocalPlugins();

    for (const lp of localPlugins) {
      if (!enabledLocalOrFramework.includes(lp.name)) continue;
      const excluded = new Set(profile.excludedItems?.[lp.name] ?? []);

      for (const item of lp.items) {
        if (excluded.has(item.name)) continue;

        if (item.type === "skill") {
          const skillDir = path.dirname(item.path);
          const tgtDir = path.join(configDir, "skills", path.basename(skillDir));
          fs.mkdirSync(path.join(configDir, "skills"), { recursive: true });
          if (!fs.existsSync(tgtDir)) fs.symlinkSync(skillDir, tgtDir);
        } else if (item.type === "agent") {
          const tgt = path.join(configDir, "agents", path.basename(item.path));
          fs.mkdirSync(path.join(configDir, "agents"), { recursive: true });
          if (!fs.existsSync(tgt)) fs.symlinkSync(item.path, tgt);
        } else if (item.type === "command") {
          const sourceCommands = path.join(CLAUDE_HOME, "commands");
          const targetCommands = path.join(configDir, "commands");
          fs.mkdirSync(targetCommands, { recursive: true });
          const relPath = path.relative(sourceCommands, item.path);
          const parts = relPath.split(path.sep);
          if (parts.length === 2) {
            const nsDir = path.join(sourceCommands, parts[0]);
            const tgt = path.join(targetCommands, parts[0]);
            if (!fs.existsSync(tgt)) fs.symlinkSync(nsDir, tgt);
          } else {
            const tgt = path.join(targetCommands, path.basename(item.path));
            if (!fs.existsSync(tgt)) fs.symlinkSync(item.path, tgt);
          }
        }
      }
    }
  }

  // Symlink GSD runtime directory and hooks if framework:gsd is enabled
  if (profile.plugins.includes(`${FRAMEWORK_PLUGIN_PREFIX}gsd`)) {
    const gsdRuntime = path.join(CLAUDE_HOME, "get-shit-done");
    const gsdTgt = path.join(configDir, "get-shit-done");
    if (fs.existsSync(gsdRuntime) && !fs.existsSync(gsdTgt)) {
      fs.symlinkSync(gsdRuntime, gsdTgt);
    }

    // Symlink GSD hook scripts
    const hooksSource = path.join(CLAUDE_HOME, "hooks");
    if (fs.existsSync(hooksSource)) {
      const hooksDest = path.join(configDir, "hooks");
      fs.mkdirSync(hooksDest, { recursive: true });
      for (const file of fs.readdirSync(hooksSource)) {
        if (!file.startsWith("gsd-")) continue;
        const tgt = path.join(hooksDest, file);
        if (!fs.existsSync(tgt)) {
          fs.symlinkSync(path.join(hooksSource, file), tgt);
        }
      }
    }
  }

  // Symlink plugin state files
  for (const file of ["known_marketplaces.json"]) {
    const src = path.join(CLAUDE_HOME, "plugins", file);
    const tgt = path.join(configDir, "plugins", file);
    if (fs.existsSync(src)) {
      if (fs.existsSync(tgt)) fs.unlinkSync(tgt);
      fs.symlinkSync(src, tgt);
    }
  }

  // Symlink other plugin state files
  for (const file of ["blocklist.json", "install-counts-cache.json"]) {
    const src = path.join(CLAUDE_HOME, "plugins", file);
    const tgt = path.join(configDir, "plugins", file);
    if (fs.existsSync(src)) {
      if (fs.existsSync(tgt)) fs.unlinkSync(tgt);
      fs.symlinkSync(src, tgt);
    }
  }

  // Symlink only marketplaces the profile actually needs. Symlinking every
  // marketplace unconditionally (the previous behaviour) let Claude Code
  // discover plugins from marketplaces the user hadn't enabled and
  // auto-register them into the profile's installed_plugins.json with a
  // synthetic `version: "unknown"` entry — defeating profile isolation for
  // any plugin whose marketplace was installed globally, most notably the
  // built-in `claudeworks` marketplace containing profiles-manager.
  const neededMarketplaces = new Set<string>();
  for (const pluginName of profile.plugins) {
    const marketplace = pluginName.split("@")[1];
    if (marketplace) neededMarketplaces.add(marketplace);
  }
  const sourceMp = path.join(CLAUDE_HOME, "plugins", "marketplaces");
  const targetMp = path.join(configDir, "plugins", "marketplaces");

  // Clean up stale marketplace symlinks from a previous assembly so toggling
  // a plugin off actually removes its marketplace from the profile.
  if (fs.existsSync(targetMp)) {
    for (const entry of fs.readdirSync(targetMp)) {
      if (neededMarketplaces.has(entry)) continue;
      const stale = path.join(targetMp, entry);
      try {
        const stat = fs.lstatSync(stale);
        if (stat.isSymbolicLink()) fs.unlinkSync(stale);
      } catch { /* ignore */ }
    }
  }

  if (fs.existsSync(sourceMp)) {
    for (const entry of fs.readdirSync(sourceMp)) {
      if (!neededMarketplaces.has(entry)) continue;
      const tgt = path.join(targetMp, entry);
      if (!fs.existsSync(tgt)) {
        fs.symlinkSync(path.join(sourceMp, entry), tgt);
      }
    }
  }

  // Symlink all data entries
  const sourceData = path.join(CLAUDE_HOME, "plugins", "data");
  const targetData = path.join(configDir, "plugins", "data");
  if (fs.existsSync(sourceData)) {
    for (const entry of fs.readdirSync(sourceData)) {
      const tgt = path.join(targetData, entry);
      if (!fs.existsSync(tgt)) {
        fs.symlinkSync(path.join(sourceData, entry), tgt);
      }
    }
  }
}
