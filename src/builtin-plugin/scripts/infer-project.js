#!/usr/bin/env node
/**
 * infer-project.js
 *
 * Bounded codebase signal extractor used by the profile recommender as Layer 0.
 * Reads a fixed set of high-signal manifest and config files from a project
 * directory and emits a JSON signal bundle on stdout.
 *
 * Usage:  node infer-project.js [projectPath]
 * Output: single-line JSON to stdout; diagnostics to stderr.
 *
 * Constraints:
 *   - No external dependencies (fs + path + os only).
 *   - Bounded traversal (max depth 4, max file count 10,000).
 *   - Hard denylist: never reads .env*, secret/credential files, private keys,
 *     .git contents, or known package/build directories.
 *   - Never throws to the caller — all filesystem errors are swallowed and
 *     surfaced as "absent" signals.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

// ─── Configuration ──────────────────────────────────────────────────────────

const MAX_FILES_TO_COUNT = 10000;
const MAX_WALK_DEPTH = 4;
const README_LINES_TO_READ = 40;
const PROJECT_PURPOSE_MAX_CHARS = 300;
const KEY_DEPS_CAP = 20;

// Directories always skipped during traversal or detection.
const SKIP_DIRS = new Set([
  ".git", "node_modules", ".venv", "venv", "env", "vendor", "target",
  "build", "dist", ".build", ".next", ".nuxt", "__pycache__",
  ".svelte-kit", ".output", ".turbo", ".cache", "coverage",
  ".idea", ".vscode", ".DS_Store",
]);

// Filename patterns that must never be read.
const DENYLIST_PATTERNS = [
  /^\.env($|\.)/i,
  /secret/i,
  /credential/i,
  /\.pem$/i,
  /\.key$/i,
  /^id_rsa/,
  /private.*key/i,
];

// ─── Safe filesystem helpers ────────────────────────────────────────────────

function isDenied(filename) {
  return DENYLIST_PATTERNS.some((p) => p.test(filename));
}

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function readSafe(filepath) {
  try {
    if (isDenied(path.basename(filepath))) return null;
    return fs.readFileSync(filepath, "utf-8");
  } catch { return null; }
}

function readJsonSafe(filepath) {
  const content = readSafe(filepath);
  if (!content) return null;
  try { return JSON.parse(content); } catch { return null; }
}

// ─── Detectors ──────────────────────────────────────────────────────────────

function detectLanguages(root) {
  const langs = new Set();
  const manifestTests = [
    { file: "package.json",        lang: "javascript" },
    { file: "tsconfig.json",       lang: "typescript" },
    { file: "pyproject.toml",      lang: "python" },
    { file: "requirements.txt",    lang: "python" },
    { file: "setup.py",            lang: "python" },
    { file: "Pipfile",             lang: "python" },
    { file: "Cargo.toml",          lang: "rust" },
    { file: "go.mod",              lang: "go" },
    { file: "Package.swift",       lang: "swift" },
    { file: "Gemfile",             lang: "ruby" },
    { file: "pom.xml",             lang: "java" },
    { file: "build.gradle",        lang: "java" },
    { file: "build.gradle.kts",    lang: "kotlin" },
    { file: "composer.json",       lang: "php" },
    { file: "mix.exs",             lang: "elixir" },
    { file: "deno.json",           lang: "deno" },
    { file: "deno.jsonc",          lang: "deno" },
  ];
  for (const { file, lang } of manifestTests) {
    if (exists(path.join(root, file))) langs.add(lang);
  }
  // TypeScript subsumes JavaScript when both are present.
  if (langs.has("typescript")) langs.delete("javascript");
  return Array.from(langs);
}

function detectFrameworks(root, languages, packageJson, pyprojectToml) {
  const frameworks = new Set();

  // JavaScript/TypeScript framework config fingerprints
  const jsConfigFingerprints = [
    { files: ["next.config.js", "next.config.ts", "next.config.mjs"], fw: "nextjs" },
    { files: ["nuxt.config.js", "nuxt.config.ts"],                    fw: "nuxt" },
    { files: ["svelte.config.js", "svelte.config.ts"],                fw: "sveltekit" },
    { files: ["astro.config.mjs", "astro.config.ts"],                 fw: "astro" },
    { files: ["angular.json"],                                        fw: "angular" },
    { files: ["remix.config.js", "remix.config.ts"],                  fw: "remix" },
    { files: ["vite.config.js", "vite.config.ts", "vite.config.mjs"], fw: "vite" },
  ];
  for (const { files, fw } of jsConfigFingerprints) {
    if (files.some((f) => exists(path.join(root, f)))) frameworks.add(fw);
  }

  // JavaScript/TypeScript framework fingerprints via package.json deps
  if (packageJson) {
    const deps = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {}),
    };
    const depMap = {
      "react":        "react",
      "vue":          "vue",
      "@angular/core":"angular",
      "express":      "express",
      "fastify":      "fastify",
      "@nestjs/core": "nestjs",
      "tailwindcss":  "tailwind",
      "electron":     "electron",
      "hono":         "hono",
    };
    for (const [dep, fw] of Object.entries(depMap)) {
      if (deps[dep]) frameworks.add(fw);
    }
  }

  // Python framework fingerprints via pyproject / requirements
  if (languages.includes("python")) {
    const pyText = (pyprojectToml || "") +
      "\n" + (readSafe(path.join(root, "requirements.txt")) || "");
    if (/\bfastapi\b/i.test(pyText))  frameworks.add("fastapi");
    if (/\bdjango\b/i.test(pyText))   frameworks.add("django");
    if (/\bflask\b/i.test(pyText))    frameworks.add("flask");
    if (/\bstarlette\b/i.test(pyText))frameworks.add("starlette");
  }

  // Swift framework fingerprints
  if (languages.includes("swift")) {
    const swiftPkg = readSafe(path.join(root, "Package.swift")) || "";
    if (/vapor/i.test(swiftPkg)) frameworks.add("vapor");
    if (exists(path.join(root, "Info.plist"))) frameworks.add("ios-macos");
  }

  // Ruby framework fingerprints
  if (languages.includes("ruby")) {
    const gemfile = readSafe(path.join(root, "Gemfile")) || "";
    if (/\brails\b/i.test(gemfile)) frameworks.add("rails");
    if (/\bsinatra\b/i.test(gemfile)) frameworks.add("sinatra");
  }

  // Mobile / native fingerprints
  if (exists(path.join(root, "AndroidManifest.xml"))) frameworks.add("android");
  const appJson = readJsonSafe(path.join(root, "app.json"));
  if (appJson && appJson.expo) frameworks.add("expo");

  // Monorepo fingerprints — not frameworks per se, but load-bearing context.
  if (exists(path.join(root, "turbo.json")))          frameworks.add("turborepo");
  if (exists(path.join(root, "nx.json")))             frameworks.add("nx");
  if (exists(path.join(root, "pnpm-workspace.yaml"))) frameworks.add("pnpm-workspace");
  if (exists(path.join(root, "lerna.json")))          frameworks.add("lerna");

  return Array.from(frameworks);
}

function detectKeyDependencies(root, packageJson, pyprojectToml) {
  const deps = [];

  // JavaScript / TypeScript
  if (packageJson) {
    const allDeps = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {}),
    };
    const filtered = Object.keys(allDeps).filter(
      (k) => !k.startsWith("@types/") && !/^(eslint|prettier|typescript)(-|$)/.test(k),
    );
    deps.push(...filtered.slice(0, 15));
  }

  // Python — pyproject.toml (poetry and PEP 621 formats)
  if (pyprojectToml) {
    // Extract from [tool.poetry.dependencies] and [project.dependencies]
    const sections = pyprojectToml.match(/\[(?:tool\.poetry\.dependencies|project)\][^\[]*/g) || [];
    for (const section of sections) {
      const lines = section.match(/^([a-zA-Z0-9_-]+)\s*=/gm) || [];
      for (const line of lines) {
        const name = line.split("=")[0].trim();
        if (name && name !== "python" && name !== "name" && name !== "version") {
          deps.push(name);
        }
      }
      // PEP 621 list-of-strings style: dependencies = ["foo>=1.0", "bar~=2.0"]
      const listMatch = section.match(/dependencies\s*=\s*\[([^\]]*)\]/);
      if (listMatch) {
        const items = listMatch[1].match(/"([^"]+)"/g) || [];
        for (const item of items) {
          const name = item.replace(/"/g, "").split(/[<>=~!\s]/)[0].trim();
          if (name) deps.push(name);
        }
      }
    }
  }

  // Python — requirements.txt
  const reqText = readSafe(path.join(root, "requirements.txt"));
  if (reqText) {
    const lines = reqText.split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#") && !l.startsWith("-"))
      .map((l) => l.split(/[<>=~!\s]/)[0].trim())
      .filter(Boolean);
    deps.push(...lines.slice(0, 15));
  }

  // Rust — Cargo.toml
  const cargo = readSafe(path.join(root, "Cargo.toml"));
  if (cargo) {
    const depSection = cargo.match(/\[dependencies\][^\[]*/);
    if (depSection) {
      const lines = depSection[0].match(/^([a-zA-Z0-9_-]+)\s*=/gm) || [];
      for (const line of lines) deps.push(line.split("=")[0].trim());
    }
  }

  // Deduplicate, cap.
  return Array.from(new Set(deps)).slice(0, KEY_DEPS_CAP);
}

function detectTooling(root, pyprojectToml) {
  const tools = new Set();
  const configs = {
    ".eslintrc.js":              "eslint",
    ".eslintrc.json":            "eslint",
    ".eslintrc.cjs":             "eslint",
    "eslint.config.js":          "eslint",
    "eslint.config.mjs":         "eslint",
    ".prettierrc":               "prettier",
    ".prettierrc.json":          "prettier",
    ".prettierrc.js":            "prettier",
    "prettier.config.js":        "prettier",
    "tsconfig.json":             "typescript",
    ".ruff.toml":                "ruff",
    "ruff.toml":                 "ruff",
    "mypy.ini":                  "mypy",
    ".swiftlint.yml":            "swiftlint",
    ".swiftlint.yaml":           "swiftlint",
    ".rubocop.yml":              "rubocop",
    "rustfmt.toml":              "rustfmt",
    ".rustfmt.toml":             "rustfmt",
    ".golangci.yml":             "golangci",
    ".golangci.yaml":            "golangci",
    ".pre-commit-config.yaml":   "pre-commit",
    ".editorconfig":             "editorconfig",
  };
  for (const [file, tool] of Object.entries(configs)) {
    if (exists(path.join(root, file))) tools.add(tool);
  }
  if (pyprojectToml) {
    if (/\[tool\.ruff/.test(pyprojectToml))  tools.add("ruff");
    if (/\[tool\.mypy/.test(pyprojectToml))  tools.add("mypy");
    if (/\[tool\.black/.test(pyprojectToml)) tools.add("black");
    if (/\[tool\.isort/.test(pyprojectToml)) tools.add("isort");
  }
  return Array.from(tools);
}

function detectTestFrameworks(root, packageJson, pyprojectToml) {
  const tfs = new Set();
  if (packageJson) {
    const deps = {
      ...(packageJson.dependencies || {}),
      ...(packageJson.devDependencies || {}),
    };
    if (deps.jest || exists(path.join(root, "jest.config.js")) || exists(path.join(root, "jest.config.ts"))) {
      tfs.add("jest");
    }
    if (deps.vitest || exists(path.join(root, "vitest.config.js")) || exists(path.join(root, "vitest.config.ts"))) {
      tfs.add("vitest");
    }
    if (deps["@playwright/test"] || exists(path.join(root, "playwright.config.js")) || exists(path.join(root, "playwright.config.ts"))) {
      tfs.add("playwright");
    }
    if (deps.cypress || exists(path.join(root, "cypress.config.js")) || exists(path.join(root, "cypress.config.ts"))) {
      tfs.add("cypress");
    }
    if (deps.mocha) tfs.add("mocha");
  }
  if (exists(path.join(root, "pytest.ini")) || (pyprojectToml && /\[tool\.pytest/.test(pyprojectToml))) {
    tfs.add("pytest");
  }
  if (exists(path.join(root, "Tests")) && exists(path.join(root, "Package.swift"))) {
    tfs.add("xctest");
  }
  return Array.from(tfs);
}

function detectInfra(root) {
  const infra = new Set();
  if (exists(path.join(root, "Dockerfile"))) infra.add("docker");
  if (exists(path.join(root, "docker-compose.yml")) || exists(path.join(root, "docker-compose.yaml"))) {
    infra.add("docker-compose");
  }
  if (exists(path.join(root, ".github", "workflows"))) infra.add("github-actions");
  if (exists(path.join(root, ".circleci")))            infra.add("circleci");
  if (exists(path.join(root, ".gitlab-ci.yml")))       infra.add("gitlab-ci");
  if (exists(path.join(root, "k8s")) || exists(path.join(root, "kubernetes"))) infra.add("kubernetes");
  if (exists(path.join(root, "fly.toml")))             infra.add("fly");
  if (exists(path.join(root, "vercel.json")))          infra.add("vercel");
  if (exists(path.join(root, "netlify.toml")))         infra.add("netlify");
  if (exists(path.join(root, "Procfile")))             infra.add("heroku");

  // Terraform — any .tf file at root
  try {
    const rootFiles = fs.readdirSync(root);
    if (rootFiles.some((f) => f.endsWith(".tf"))) infra.add("terraform");
  } catch { /* ignore */ }

  return Array.from(infra);
}

function detectAIConfig(root) {
  return {
    hasClaudeMd:   exists(path.join(root, "CLAUDE.md")),
    hasAgentsMd:   exists(path.join(root, "AGENTS.md")),
    hasGeminiMd:   exists(path.join(root, "GEMINI.md")),
    hasMcpConfig:  exists(path.join(root, ".mcp.json")) || exists(path.join(root, ".mcp")),
    hasClaudeDir:  exists(path.join(root, ".claude")),
    hasCursorRules:exists(path.join(root, ".cursor")) || exists(path.join(root, ".cursorrules")),
  };
}

function detectProjectPurpose(root) {
  const readmes = ["README.md", "README.MD", "Readme.md", "readme.md", "README.rst", "README.txt"];
  for (const name of readmes) {
    const readme = readSafe(path.join(root, name));
    if (!readme) continue;

    const lines = readme.split("\n").slice(0, README_LINES_TO_READ);
    const prose = [];
    let inProse = false;
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        if (inProse) break; // end of first paragraph
        continue;
      }
      if (trimmed.startsWith("#"))                 { if (inProse) break; continue; }
      if (/^(!\[|\[!\[|<|---)/.test(trimmed))      { continue; }
      inProse = true;
      prose.push(trimmed);
    }
    if (prose.length > 0) return prose.join(" ").slice(0, PROJECT_PURPOSE_MAX_CHARS);
  }
  return null;
}

function countFiles(root, maxCount = MAX_FILES_TO_COUNT, maxDepth = MAX_WALK_DEPTH) {
  let count = 0;
  function walk(dir, depth) {
    if (count >= maxCount || depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (count >= maxCount) return;
      if (entry.name.startsWith(".") && entry.name !== ".github") continue;
      if (SKIP_DIRS.has(entry.name)) continue;
      if (entry.isDirectory())      walk(path.join(dir, entry.name), depth + 1);
      else if (entry.isFile())      count++;
    }
  }
  walk(root, 0);
  return count;
}

function categorizeSize(fileCount) {
  if (fileCount === 0)                 return "empty";
  if (fileCount < 50)                  return "small";
  if (fileCount < 1000)                return "medium";
  if (fileCount < MAX_FILES_TO_COUNT)  return "large";
  return "huge";
}

function calculateConfidence({ languages, frameworks, tooling, keyDependencies, fileCount }) {
  if (languages.length === 0)  return "low";
  if (fileCount < 5)           return "low";

  const hasFramework      = frameworks.length > 0;
  const hasTooling        = tooling.length > 0;
  const hasDeps           = keyDependencies.length > 0;
  const hasMultipleLangs  = languages.length > 1;

  if (!hasMultipleLangs && (hasFramework || hasTooling) && hasDeps)   return "high";
  if (hasMultipleLangs && (hasFramework || hasTooling))               return "medium";
  if (!hasFramework && !hasTooling)                                   return "low";
  return "medium";
}

// ─── Main ───────────────────────────────────────────────────────────────────

function emptyAIConfig() {
  return {
    hasClaudeMd:    false,
    hasAgentsMd:    false,
    hasGeminiMd:    false,
    hasMcpConfig:   false,
    hasClaudeDir:   false,
    hasCursorRules: false,
  };
}

function emitGeneric(projectPath, reason) {
  const bundle = {
    mode: "generic",
    projectRoot: projectPath,
    languages: [],
    frameworks: [],
    keyDependencies: [],
    tooling: [],
    testFrameworks: [],
    infra: [],
    existingAIConfig: emptyAIConfig(),
    projectPurpose: null,
    size: { files: 0, category: "empty" },
    confidence: "generic",
    reason,
  };
  process.stdout.write(JSON.stringify(bundle) + "\n");
}

function main() {
  const projectPath = path.resolve(process.argv[2] || process.cwd());

  let stat;
  try { stat = fs.statSync(projectPath); }
  catch {
    process.stderr.write(`infer-project: path does not exist: ${projectPath}\n`);
    process.exit(1);
  }
  if (!stat.isDirectory()) {
    process.stderr.write(`infer-project: not a directory: ${projectPath}\n`);
    process.exit(1);
  }

  // Early generic-mode detection for home directory launches.
  if (projectPath === os.homedir()) {
    emitGeneric(projectPath, "launched from home directory");
    return;
  }

  const languages     = detectLanguages(projectPath);
  const packageJson   = readJsonSafe(path.join(projectPath, "package.json"));
  const pyprojectToml = readSafe(path.join(projectPath, "pyproject.toml"));

  // No language manifests at all — check if there's enough to call it a project.
  if (languages.length === 0) {
    const fileCount = countFiles(projectPath);
    if (fileCount < 5) {
      emitGeneric(projectPath, "empty or near-empty directory");
      return;
    }
    const aiConfig = detectAIConfig(projectPath);
    if (!aiConfig.hasClaudeMd && !aiConfig.hasAgentsMd && !aiConfig.hasClaudeDir) {
      emitGeneric(projectPath, "no language manifests or AI config");
      return;
    }
    // Low-confidence project: has AI config but no manifests (e.g. a docs-only repo).
    const bundle = {
      mode: "project",
      projectRoot: projectPath,
      languages: [],
      frameworks: [],
      keyDependencies: [],
      tooling: [],
      testFrameworks: [],
      infra: detectInfra(projectPath),
      existingAIConfig: aiConfig,
      projectPurpose: detectProjectPurpose(projectPath),
      size: { files: fileCount, category: categorizeSize(fileCount) },
      confidence: "low",
    };
    process.stdout.write(JSON.stringify(bundle) + "\n");
    return;
  }

  // Full project-mode detection.
  const frameworks      = detectFrameworks(projectPath, languages, packageJson, pyprojectToml);
  const keyDependencies = detectKeyDependencies(projectPath, packageJson, pyprojectToml);
  const tooling         = detectTooling(projectPath, pyprojectToml);
  const testFrameworks  = detectTestFrameworks(projectPath, packageJson, pyprojectToml);
  const infra           = detectInfra(projectPath);
  const existingAIConfig= detectAIConfig(projectPath);
  const projectPurpose  = detectProjectPurpose(projectPath);
  const fileCount       = countFiles(projectPath);
  const confidence      = calculateConfidence({ languages, frameworks, tooling, keyDependencies, fileCount });

  const bundle = {
    mode: "project",
    projectRoot: projectPath,
    languages,
    frameworks,
    keyDependencies,
    tooling,
    testFrameworks,
    infra,
    existingAIConfig,
    projectPurpose,
    size: { files: fileCount, category: categorizeSize(fileCount) },
    confidence,
  };

  process.stdout.write(JSON.stringify(bundle) + "\n");
}

main();
