/**
 * Smoke test for the profile-assembly pipeline.
 *
 * Creates a temporary HOME with synthetic Claude plugin data, runs
 * assembleProfile, and verifies the output cache tree has the expected
 * structure (symlinks, real dirs, excluded items absent, marketplace.json
 * patched, fingerprint marker written).
 *
 * This test exercises the real filesystem — no mocks. It's the safety net
 * for the core.ts refactor: if the assembly pipeline breaks, this test
 * catches it.
 */
import { describe, it, expect, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// ---------------------------------------------------------------------------
// Override HOME before importing core.ts — the module evaluates
// os.homedir() at import time to compute CLAUDE_HOME and PROFILES_DIR.
// ---------------------------------------------------------------------------
const originalHome = process.env.HOME;
// Resolve the temp dir through realpathSync so macOS's /tmp → /private/tmp
// symlink doesn't create path mismatches between fs.realpathSync output
// (used by the overlay walker) and the fixture-registered installPath values.
const testHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "claude-profiles-smoke-")));
process.env.HOME = testHome;

// Dynamic import so core.ts sees our overridden HOME.
const plugins = await import("../src/electron/plugins");
const assembly = await import("../src/electron/assembly");
const core = {
  assembleProfile: assembly.assembleProfile,
  invalidatePluginCaches: plugins.invalidatePluginCaches,
  scanPluginItems: plugins.scanPluginItems,
};

const CLAUDE_HOME = path.join(testHome, ".claude");
const PROFILES_DIR = path.join(testHome, ".claude-profiles");

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const MARKETPLACE = "test-marketplace";

function writeSkill(pluginCacheDir: string, skillName: string): void {
  const skillDir = path.join(pluginCacheDir, "skills", skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: Smoke test skill ${skillName}\n---\n\nSkill body for ${skillName}.\n`,
  );
}

function writeCommand(pluginCacheDir: string, cmdName: string): void {
  const cmdsDir = path.join(pluginCacheDir, "commands");
  fs.mkdirSync(cmdsDir, { recursive: true });
  fs.writeFileSync(
    path.join(cmdsDir, `${cmdName}.md`),
    `---\nname: ${cmdName}\ndescription: Smoke test command ${cmdName}\n---\n\nCommand body.\n`,
  );
}

function writeAgent(pluginCacheDir: string, agentName: string): void {
  const agentsDir = path.join(pluginCacheDir, "agents");
  fs.mkdirSync(agentsDir, { recursive: true });
  fs.writeFileSync(
    path.join(agentsDir, `${agentName}.md`),
    `---\nname: ${agentName}\ndescription: Smoke test agent ${agentName}\n---\n\nAgent body.\n`,
  );
}

function createPlugin(
  pluginName: string,
  version: string,
  opts: {
    skills?: string[];
    commands?: string[];
    agents?: string[];
    extraFiles?: Record<string, string>;
  },
): string {
  const cacheDir = path.join(
    CLAUDE_HOME, "plugins", "cache", MARKETPLACE, pluginName, version,
  );
  fs.mkdirSync(path.join(cacheDir, ".claude-plugin"), { recursive: true });

  // Write a minimal plugin.json. Don't declare skills/commands/agents
  // explicitly — let scanPluginItems auto-discover from the conventional
  // skills/, commands/, agents/ directories, which is what most real
  // plugins rely on.
  fs.writeFileSync(
    path.join(cacheDir, ".claude-plugin", "plugin.json"),
    JSON.stringify({ name: pluginName }, null, 2),
  );

  // Write marketplace.json.
  const marketplaceJson = {
    plugins: [{
      name: pluginName,
      source: "./",
      ...(opts.skills ? { skills: opts.skills.map((s) => `skills/${s}`) } : {}),
      ...(opts.commands ? { commands: opts.commands.map((c) => `commands/${c}.md`) } : {}),
      ...(opts.agents ? { agents: opts.agents.map((a) => `agents/${a}.md`) } : {}),
    }],
  };
  fs.writeFileSync(
    path.join(cacheDir, ".claude-plugin", "marketplace.json"),
    JSON.stringify(marketplaceJson, null, 2),
  );

  // Write item files.
  for (const s of opts.skills ?? []) writeSkill(cacheDir, s);
  for (const c of opts.commands ?? []) writeCommand(cacheDir, c);
  for (const a of opts.agents ?? []) writeAgent(cacheDir, a);

  // Write any extra files (e.g. lib/, readme).
  for (const [relPath, content] of Object.entries(opts.extraFiles ?? {})) {
    const full = path.join(cacheDir, relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }

  return cacheDir;
}

function registerPlugins(
  plugins: Array<{ name: string; version: string }>,
): void {
  const manifest: Record<string, any> = { version: 2, plugins: {} };
  for (const p of plugins) {
    const fullName = `${p.name}@${MARKETPLACE}`;
    manifest.plugins[fullName] = [{
      scope: "user",
      installPath: path.join(
        CLAUDE_HOME, "plugins", "cache", MARKETPLACE, p.name, p.version,
      ),
      version: p.version,
    }];
  }
  const manifestDir = path.join(CLAUDE_HOME, "plugins");
  fs.mkdirSync(manifestDir, { recursive: true });
  fs.writeFileSync(
    path.join(manifestDir, "installed_plugins.json"),
    JSON.stringify(manifest, null, 2),
  );
}

function makeProfile(
  name: string,
  plugins: string[],
  excludedItems?: Record<string, string[]>,
): import("../src/electron/types").Profile {
  return {
    name,
    plugins: plugins.map((p) => `${p}@${MARKETPLACE}`),
    excludedItems: excludedItems
      ? Object.fromEntries(
          Object.entries(excludedItems).map(([k, v]) => [`${k}@${MARKETPLACE}`, v]),
        )
      : {},
    customClaudeMd: "",
    useDefaultAuth: false,
  } as import("../src/electron/types").Profile;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

afterAll(() => {
  process.env.HOME = originalHome;
  try {
    fs.rmSync(testHome, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; CI can rely on tmpdir reaping.
  }
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("assembleProfile", () => {
  // ─── Fixture setup (shared across tests in this describe) ───────────────
  const ALPHA_VERSION = "1.0.0";
  const BETA_VERSION = "2.0.0";

  createPlugin("alpha-plugin", ALPHA_VERSION, {
    skills: ["skill-a", "skill-b", "skill-c"],
    commands: ["cmd-a"],
    agents: ["agent-a"],
    extraFiles: {
      "README.md": "# Alpha Plugin\n",
      "lib/helper.js": "module.exports = {};\n",
    },
  });

  createPlugin("beta-plugin", BETA_VERSION, {
    skills: ["skill-x", "skill-y", "skill-z", "skill-w", "skill-v"],
    commands: ["cmd-x"],
    extraFiles: {
      "README.md": "# Beta Plugin\n",
      "scripts/setup.sh": "#!/bin/bash\necho setup\n",
    },
  });

  registerPlugins([
    { name: "alpha-plugin", version: ALPHA_VERSION },
    { name: "beta-plugin", version: BETA_VERSION },
  ]);

  // ─── Test: basic assembly (no exclusions) ─────────────────────────────

  it("assembles a profile with no exclusions", () => {
    const profile = makeProfile("test-basic", ["alpha-plugin", "beta-plugin"]);
    const configDir = core.assembleProfile(profile);

    // Config dir was created.
    expect(fs.existsSync(configDir)).toBe(true);

    // settings.json was written.
    const settingsPath = path.join(configDir, "settings.json");
    expect(fs.existsSync(settingsPath)).toBe(true);
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    expect(settings.enabledPlugins).toBeDefined();

    // Plugin cache dir has marketplace symlinks.
    const cacheDir = path.join(configDir, "plugins", "cache");
    expect(fs.existsSync(cacheDir)).toBe(true);
    const marketplaceEntry = path.join(cacheDir, MARKETPLACE);
    expect(fs.existsSync(marketplaceEntry)).toBe(true);

    // installed_plugins.json was written.
    const manifestPath = path.join(configDir, "plugins", "installed_plugins.json");
    expect(fs.existsSync(manifestPath)).toBe(true);

    // Fingerprint marker was written.
    const markerPath = path.join(configDir, ".assembly-fingerprint.json");
    expect(fs.existsSync(markerPath)).toBe(true);
    const marker = JSON.parse(fs.readFileSync(markerPath, "utf-8"));
    expect(marker.fingerprint).toBeDefined();
    expect(typeof marker.fingerprint).toBe("string");
    expect(marker.fingerprint.length).toBeGreaterThan(0);
  });

  // ─── Test: exclusions produce an overlay (not a full copy) ────────────

  it("assembles a profile with exclusions using overlay structure", () => {
    const profile = makeProfile(
      "test-excluded",
      ["alpha-plugin", "beta-plugin"],
      { "beta-plugin": ["skill-x", "skill-y"] },
    );
    const configDir = core.assembleProfile(profile);

    const betaOverlay = path.join(
      configDir, "plugins", "cache", MARKETPLACE, "beta-plugin", BETA_VERSION,
    );

    // The overlay dir exists (real dir, not a symlink).
    expect(fs.existsSync(betaOverlay)).toBe(true);
    const overlayStat = fs.lstatSync(
      path.join(configDir, "plugins", "cache", MARKETPLACE, "beta-plugin"),
    );
    expect(overlayStat.isSymbolicLink()).toBe(false);

    // .claude-plugin/ is a real dir (materialised for marketplace.json patch).
    const claudePluginDir = path.join(betaOverlay, ".claude-plugin");
    expect(fs.lstatSync(claudePluginDir).isDirectory()).toBe(true);
    expect(fs.lstatSync(claudePluginDir).isSymbolicLink()).toBe(false);

    // plugin.json inside .claude-plugin/ is a symlink to the source.
    const pluginJson = path.join(claudePluginDir, "plugin.json");
    expect(fs.existsSync(pluginJson)).toBe(true);
    expect(fs.lstatSync(pluginJson).isSymbolicLink()).toBe(true);

    // marketplace.json is a real file (patched, not a symlink).
    const mktJson = path.join(claudePluginDir, "marketplace.json");
    expect(fs.existsSync(mktJson)).toBe(true);
    expect(fs.lstatSync(mktJson).isSymbolicLink()).toBe(false);

    // Patched marketplace.json should NOT list excluded skills.
    const mktManifest = JSON.parse(fs.readFileSync(mktJson, "utf-8"));
    const skillPaths: string[] = mktManifest.plugins?.[0]?.skills ?? [];
    const skillNames = skillPaths.map((p: string) => p.split("/").pop());
    expect(skillNames).not.toContain("skill-x");
    expect(skillNames).not.toContain("skill-y");
    expect(skillNames).toContain("skill-z");
    expect(skillNames).toContain("skill-w");
    expect(skillNames).toContain("skill-v");

    // Excluded skill directories should be absent from the overlay.
    expect(fs.existsSync(path.join(betaOverlay, "skills", "skill-x"))).toBe(false);
    expect(fs.existsSync(path.join(betaOverlay, "skills", "skill-y"))).toBe(false);

    // Kept skill directories should be present (as symlinks).
    expect(fs.existsSync(path.join(betaOverlay, "skills", "skill-z"))).toBe(true);
    expect(fs.existsSync(path.join(betaOverlay, "skills", "skill-w"))).toBe(true);
    expect(fs.existsSync(path.join(betaOverlay, "skills", "skill-v"))).toBe(true);

    // Non-skill top-level entries should be symlinks (shared, not copied).
    const readmeLink = path.join(betaOverlay, "README.md");
    expect(fs.existsSync(readmeLink)).toBe(true);
    expect(fs.lstatSync(readmeLink).isSymbolicLink()).toBe(true);

    const scriptsLink = path.join(betaOverlay, "scripts");
    expect(fs.existsSync(scriptsLink)).toBe(true);
    expect(fs.lstatSync(scriptsLink).isSymbolicLink()).toBe(true);

    // Alpha plugin (no exclusions) should still be a simple symlink chain.
    const alphaEntry = path.join(
      configDir, "plugins", "cache", MARKETPLACE, "alpha-plugin",
    );
    expect(fs.existsSync(alphaEntry)).toBe(true);
    // It should be accessible (either directly or through symlinks).
    expect(
      fs.existsSync(path.join(alphaEntry, ALPHA_VERSION, "skills", "skill-a", "SKILL.md")),
    ).toBe(true);
  });

  // ─── Test: fingerprint skip on unchanged second assembly ──────────────

  it("skips rebuild when fingerprint matches", () => {
    const profile = makeProfile("test-fingerprint", ["alpha-plugin"]);

    // First assembly — cold, writes the fingerprint marker.
    const configDir = core.assembleProfile(profile);
    const markerPath = path.join(configDir, ".assembly-fingerprint.json");
    const marker1 = JSON.parse(fs.readFileSync(markerPath, "utf-8"));

    // Write a canary file inside the cache — if the rebuild runs again, it
    // will be wiped by symlinkSelectedCaches' rename-to-trash.
    const canaryDir = path.join(configDir, "plugins", "cache", ".canary");
    fs.mkdirSync(canaryDir, { recursive: true });
    fs.writeFileSync(path.join(canaryDir, "alive"), "1");

    // Second assembly — same inputs, should skip the rebuild.
    core.assembleProfile(profile);
    const marker2 = JSON.parse(fs.readFileSync(markerPath, "utf-8"));

    // Fingerprint should be identical.
    expect(marker2.fingerprint).toBe(marker1.fingerprint);

    // Canary should still exist — the cache was NOT wiped.
    expect(fs.existsSync(path.join(canaryDir, "alive"))).toBe(true);
  });

  // ─── Test: fingerprint invalidation when plugins change ───────────────

  it("rebuilds when plugin list changes", () => {
    const profile1 = makeProfile("test-invalidation", ["alpha-plugin"]);
    const configDir = core.assembleProfile(profile1);
    const markerPath = path.join(configDir, ".assembly-fingerprint.json");
    const fp1 = JSON.parse(fs.readFileSync(markerPath, "utf-8")).fingerprint;

    // Drop a canary.
    const canaryDir = path.join(configDir, "plugins", "cache", ".canary");
    fs.mkdirSync(canaryDir, { recursive: true });
    fs.writeFileSync(path.join(canaryDir, "alive"), "1");

    // Change the plugin list and reassemble.
    const profile2 = makeProfile("test-invalidation", ["alpha-plugin", "beta-plugin"]);
    core.invalidatePluginCaches();
    core.assembleProfile(profile2);
    const fp2 = JSON.parse(fs.readFileSync(markerPath, "utf-8")).fingerprint;

    // Fingerprint should differ.
    expect(fp2).not.toBe(fp1);

    // Canary should be gone — the cache was rebuilt.
    expect(fs.existsSync(path.join(canaryDir, "alive"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// scanPluginItems — item discovery correctness
// ---------------------------------------------------------------------------

describe("scanPluginItems", () => {
  // Helper: build a minimal PluginEntry pointing at an arbitrary dir.
  function makeEntry(installPath: string): import("../src/electron/types").PluginEntry {
    return {
      name: "test-plugin@test-marketplace",
      pluginName: "test-plugin",
      marketplace: "test-marketplace",
      scope: "user",
      installPath,
      version: "1.0.0",
    };
  }

  // ─── Test: container pattern expands "skills": "./" into N skills ─────

  it('expands "skills": "./" container pattern into one item per skill subdir', () => {
    const pluginDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "scan-container-")),
    );

    // Write plugin.json declaring "skills": "./" — the container pattern.
    fs.mkdirSync(path.join(pluginDir, ".claude-plugin"), { recursive: true });
    fs.writeFileSync(
      path.join(pluginDir, ".claude-plugin", "plugin.json"),
      JSON.stringify({ name: "test-plugin", skills: ["./"] }),
    );

    // Write 5 skill subdirectories directly at the plugin root.
    const skillNames = ["alpha", "beta", "gamma", "delta", "epsilon"];
    for (const name of skillNames) {
      const skillDir = path.join(pluginDir, name);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(
        path.join(skillDir, "SKILL.md"),
        `---\nname: ${name}\ndescription: Container skill ${name}\n---\n`,
      );
    }

    const items = core.scanPluginItems(makeEntry(pluginDir));
    const skillItems = items.filter((i) => i.type === "skill");

    // Must expand to all 5 skills, not collapse to 1.
    expect(skillItems).toHaveLength(skillNames.length);
    const itemNames = skillItems.map((i) => i.name);
    for (const name of skillNames) {
      expect(itemNames).toContain(name);
    }

    fs.rmSync(pluginDir, { recursive: true, force: true });
  });

  // ─── Test: agent directory layout (agents/foo/AGENT.md) is detected ───

  it("detects agents in directory layout (agents/<name>/AGENT.md)", () => {
    const pluginDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "scan-agent-dir-")),
    );

    // No plugin.json — rely on conventional directory scan.
    const agentDir = path.join(pluginDir, "agents", "my-agent");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentDir, "AGENT.md"),
      "---\nname: my-agent\ndescription: Directory-layout agent\n---\n",
    );

    const items = core.scanPluginItems(makeEntry(pluginDir));
    const agents = items.filter((i) => i.type === "agent");

    expect(agents).toHaveLength(1);
    expect(agents[0].name).toBe("my-agent");

    fs.rmSync(pluginDir, { recursive: true, force: true });
  });

  // ─── Test: heuristic fallback surfaces root .md files as agents ───────

  it("surfaces root .md files as agents when no manifest and no subdirs", () => {
    const pluginDir = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "scan-heuristic-")),
    );

    // Root .md files — no plugin.json, no skills/commands/agents dirs.
    fs.writeFileSync(path.join(pluginDir, "my-tool.md"), "---\nname: my-tool\n---\n");
    fs.writeFileSync(path.join(pluginDir, "helper.md"), "---\nname: helper\n---\n");
    // Well-known dev-doc files that must NOT be surfaced.
    fs.writeFileSync(path.join(pluginDir, "README.md"), "# readme\n");
    fs.writeFileSync(path.join(pluginDir, "CLAUDE.md"), "# claude\n");

    const items = core.scanPluginItems(makeEntry(pluginDir));
    const agents = items.filter((i) => i.type === "agent");
    const agentNames = agents.map((i) => i.name);

    expect(agentNames).toContain("my-tool");
    expect(agentNames).toContain("helper");
    expect(agentNames).not.toContain("README");
    expect(agentNames).not.toContain("CLAUDE");

    fs.rmSync(pluginDir, { recursive: true, force: true });
  });
});
