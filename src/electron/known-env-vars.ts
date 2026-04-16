/**
 * known-env-vars.ts — registry of environment variables recognized by
 * Claude Code and Claude Profiles.
 *
 * Suggestive, not restrictive: the UI autocompletes from this list but
 * still allows arbitrary user-defined variables. Only includes variables
 * we can verify — users who need provider-specific or experimental vars
 * will know them and can type them directly.
 */

import type { KnownEnvVar } from "./types";

const KNOWN_ENV_VARS: KnownEnvVar[] = [
  // ── Claude Code / Claude Profiles ───────────────────────────────────
  {
    name: "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
    description: "Enable native agentic team mode (tmux-based multi-agent)",
    values: ["0", "1"],
    scope: "both",
    requiredFor: "teams",
  },
  {
    name: "ANTHROPIC_API_KEY",
    description: "Anthropic API key — overrides OAuth/Keychain auth",
    values: null,
    scope: "both",
  },

  // ── Network (standard, not Claude-specific) ─────────────────────────
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
];

export function getKnownEnvVars(): KnownEnvVar[] {
  return KNOWN_ENV_VARS;
}
