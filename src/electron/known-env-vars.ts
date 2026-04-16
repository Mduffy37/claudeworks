/**
 * known-env-vars.ts — registry of environment variables recognized by
 * Claude Code and Claude Profiles.
 *
 * Suggestive, not restrictive: the UI autocompletes from this list but
 * still allows arbitrary user-defined variables. Expand this list as
 * Claude Code introduces new env-var-gated features.
 */

import type { KnownEnvVar } from "./types";

const KNOWN_ENV_VARS: KnownEnvVar[] = [
  // ── Claude Code feature flags ───────────────────────────────────────
  {
    name: "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
    description: "Enable native agentic team mode (tmux-based multi-agent)",
    values: ["0", "1"],
    scope: "both",
    requiredFor: "teams",
  },

  // ── API / auth ──────────────────────────────────────────────────────
  {
    name: "ANTHROPIC_API_KEY",
    description: "Anthropic API key — overrides OAuth/Keychain auth",
    values: null,
    scope: "both",
  },
  {
    name: "ANTHROPIC_BASE_URL",
    description: "Custom base URL for the Anthropic API",
    values: null,
    scope: "both",
  },

  // ── Provider routing ────────────────────────────────────────────────
  {
    name: "CLAUDE_CODE_USE_BEDROCK",
    description: "Route requests through AWS Bedrock instead of direct API",
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
    name: "AWS_REGION",
    description: "AWS region for Bedrock requests",
    values: null,
    scope: "both",
  },
  {
    name: "AWS_PROFILE",
    description: "AWS credentials profile for Bedrock auth",
    values: null,
    scope: "both",
  },
  {
    name: "CLOUD_ML_REGION",
    description: "Google Cloud region for Vertex AI requests",
    values: null,
    scope: "both",
  },
  {
    name: "ANTHROPIC_VERTEX_PROJECT_ID",
    description: "Google Cloud project ID for Vertex AI",
    values: null,
    scope: "both",
  },

  // ── Behaviour ───────────────────────────────────────────────────────
  {
    name: "CLAUDE_CODE_MAX_TURNS",
    description: "Maximum conversation turns in non-interactive/headless mode",
    values: null,
    scope: "both",
  },
  {
    name: "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
    description: "Disable telemetry and non-essential network requests",
    values: ["0", "1"],
    scope: "global",
  },
  {
    name: "DISABLE_PROMPT_CACHING",
    description: "Disable Anthropic prompt caching (increases cost, useful for debugging)",
    values: ["0", "1"],
    scope: "both",
  },
  {
    name: "CLAUDE_CODE_SKIP_PERMISSIONS_INIT",
    description: "Skip interactive permissions setup on first run",
    values: ["0", "1"],
    scope: "global",
  },

  // ── Network ─────────────────────────────────────────────────────────
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
    name: "NO_PROXY",
    description: "Comma-separated list of hosts that bypass the proxy",
    values: null,
    scope: "global",
  },
];

export function getKnownEnvVars(): KnownEnvVar[] {
  return KNOWN_ENV_VARS;
}
