/**
 * known-env-vars.ts — registry of environment variables recognized by
 * Claude Code and ClaudeWorks.
 *
 * Suggestive, not restrictive: the UI autocompletes from this list but
 * still allows arbitrary user-defined variables. This is a curated
 * subset of the most commonly useful variables — the full reference
 * lives at https://code.claude.com/docs/en/env-vars
 */

import type { KnownEnvVar } from "./types";

const KNOWN_ENV_VARS: KnownEnvVar[] = [
  // ── Authentication ──────────────────────────────────────────────────
  {
    name: "ANTHROPIC_API_KEY",
    description: "Anthropic API key — overrides OAuth/Keychain auth",
    values: null,
    scope: "both",
  },

  // ── Provider routing ────────────────────────────────────────────────
  {
    name: "CLAUDE_CODE_USE_BEDROCK",
    description: "Route requests through Amazon Bedrock",
    values: ["0", "1"],
    scope: "both",
  },
  {
    name: "CLAUDE_CODE_USE_VERTEX",
    description: "Route requests through Google Cloud Vertex AI",
    values: ["0", "1"],
    scope: "both",
  },
  {
    name: "ANTHROPIC_BASE_URL",
    description: "Override API endpoint to route through a proxy or gateway",
    values: null,
    scope: "both",
  },

  // ── Model configuration ─────────────────────────────────────────────
  {
    name: "ANTHROPIC_MODEL",
    description: "Model alias or full model name to use",
    values: null,
    scope: "both",
  },
  {
    name: "CLAUDE_CODE_EFFORT_LEVEL",
    description: "Reasoning effort level",
    values: ["low", "medium", "high", "max", "auto"],
    scope: "both",
  },
  {
    name: "MAX_THINKING_TOKENS",
    description: "Maximum thinking tokens budget",
    values: null,
    scope: "both",
  },

  // ── Behaviour ───────────────────────────────────────────────────────
  {
    name: "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
    description: "Enable native agentic team mode (tmux-based multi-agent)",
    values: ["0", "1"],
    scope: "both",
    requiredFor: "teams",
  },
  {
    name: "CLAUDE_CODE_MAX_OUTPUT_TOKENS",
    description: "Maximum output tokens per request",
    values: null,
    scope: "both",
  },
  {
    name: "DISABLE_PROMPT_CACHING",
    description: "Disable prompt caching (increases cost, useful for debugging)",
    values: ["0", "1"],
    scope: "both",
  },
  {
    name: "BASH_DEFAULT_TIMEOUT_MS",
    description: "Default timeout for bash commands in milliseconds",
    values: null,
    scope: "both",
  },

  // ── Memory & instructions ───────────────────────────────────────────
  {
    name: "CLAUDE_CODE_DISABLE_AUTO_MEMORY",
    description: "Disable auto memory feature",
    values: ["0", "1"],
    scope: "both",
  },
  {
    name: "CLAUDE_CODE_DISABLE_CLAUDE_MDS",
    description: "Prevent loading CLAUDE.md memory files",
    values: ["0", "1"],
    scope: "both",
  },

  // ── Telemetry ───────────────────────────────────────────────────────
  {
    name: "DISABLE_TELEMETRY",
    description: "Disable all telemetry",
    values: ["0", "1"],
    scope: "global",
  },
  {
    name: "DISABLE_AUTOUPDATER",
    description: "Disable the auto-updater",
    values: ["0", "1"],
    scope: "global",
  },

  // ── Network (standard) ─────────────────────────────────────────────
  {
    name: "HTTP_PROXY",
    description: "HTTP proxy URL for outbound requests",
    values: null,
    scope: "global",
  },
  {
    name: "HTTPS_PROXY",
    description: "HTTPS proxy URL for outbound requests",
    values: null,
    scope: "global",
  },
  {
    name: "NODE_EXTRA_CA_CERTS",
    description: "Path to additional CA certificates PEM file",
    values: null,
    scope: "global",
  },
];

export function getKnownEnvVars(): KnownEnvVar[] {
  return KNOWN_ENV_VARS;
}
