const REQUIRED_VAR = "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS";
const REQUIRED_VALUE = "1";

export interface EnvCheckResult {
  satisfied: boolean;
  workDir?: string;
}

export async function checkTeamEnvRequirement(
  workDir?: string,
): Promise<EnvCheckResult> {
  const globalEnv = await window.api.getGlobalEnv();
  if (globalEnv[REQUIRED_VAR] === REQUIRED_VALUE) {
    return { satisfied: true };
  }

  if (workDir) {
    try {
      const projectSettings = await window.api.getProjectSettings(workDir);
      const projectEnv = (projectSettings?.env as Record<string, string>) ?? {};
      if (projectEnv[REQUIRED_VAR] === REQUIRED_VALUE) {
        return { satisfied: true };
      }
    } catch {
      // Project settings unreadable — treat as not set
    }
  }

  return { satisfied: false, workDir };
}

export async function addTeamEnvVar(
  target: "global" | "project",
  workDir?: string,
): Promise<void> {
  if (target === "global") {
    const env = await window.api.getGlobalEnv();
    env[REQUIRED_VAR] = REQUIRED_VALUE;
    await window.api.saveGlobalEnv(env);
  } else if (target === "project" && workDir) {
    const settings = await window.api.getProjectSettings(workDir);
    const env = (settings.env as Record<string, string>) ?? {};
    env[REQUIRED_VAR] = REQUIRED_VALUE;
    settings.env = env;
    await window.api.saveProjectSettings(workDir, settings);
  }
}
