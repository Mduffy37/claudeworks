import type { Team, TeamMember, Profile } from "./types";

interface MemberProfilePair {
  member: TeamMember;
  profile: Profile;
}

export type AddOnsMap = Map<string, { skills: string[]; agents: string[]; commands: string[] }>;

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

function formatToolLines(addOns: { skills: string[]; agents: string[]; commands: string[] }): string[] {
  const lines: string[] = [];
  if (addOns.skills.length > 0) lines.push(`Skills: ${addOns.skills.join(", ")}`);
  if (addOns.agents.length > 0) lines.push(`Agents: ${addOns.agents.join(", ")}`);
  if (addOns.commands.length > 0) lines.push(`Commands: ${addOns.commands.map(c => "/" + c).join(", ")}`);
  return lines;
}

export function generateTeamMd(
  team: Team,
  lead: TeamMember,
  nonLeadMembers: TeamMember[],
  ownedAddOns: AddOnsMap,
): string {
  let md = `# Team: ${team.name}\n\n`;
  md += `## Your Role (Team Lead)\n`;
  md += `${lead.role}${lead.instructions ? "\n" + lead.instructions : ""}\n\n`;
  md += `## Teammates\n\n`;

  for (const member of nonLeadMembers) {
    const addOns = ownedAddOns.get(member.profile) ?? { skills: [], agents: [], commands: [] };
    const slug = slugify(member.profile);
    md += `### ${member.profile} (name: "${slug}")\n`;
    md += `- **Role**: ${member.role}\n`;
    if (member.instructions) md += `- **Instructions**: ${member.instructions}\n`;
    if (addOns.skills.length > 0) md += `- **Skills**: ${addOns.skills.join(", ")}\n`;
    if (addOns.agents.length > 0) md += `- **Agents**: ${addOns.agents.join(", ")}\n`;
    if (addOns.commands.length > 0) md += `- **Commands**: ${addOns.commands.map(c => "/" + c).join(", ")}\n`;
    md += `\n`;
  }

  md += `## Add-on Ownership\n`;
  md += `Each add-on (skill, agent, command) is owned by the teammate whose profile contributed it.\n`;
  md += `- Delegate work involving a teammate's add-ons to that teammate.\n`;
  md += `- When spawning a teammate, include their role, instructions, and owned add-ons in the spawn prompt.\n`;
  md += `- Tell each teammate to only use their assigned add-ons and to report back if they need capabilities they don't own.\n`;

  return md;
}

export function generateStartTeamCommand(
  team: Team,
  lead: TeamMember,
  leadProfile: Profile,
  nonLeadMembers: TeamMember[],
  memberProfiles: MemberProfilePair[],
  ownedAddOns: AddOnsMap,
): string {
  let cmd = `# /start-team\n\n`;

  // Constraints
  cmd += `## CONSTRAINTS (non-negotiable)\n\n`;
  cmd += `1. You MUST use Claude Code's native agent teams feature. Do NOT use the Agent tool.\n`;
  cmd += `2. CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1 is set. You are inside tmux.\n`;
  cmd += `3. You MUST pass each teammate's spawn prompt VERBATIM — copy it character for character. Do not summarize, rephrase, or omit any part of it.\n`;
  cmd += `4. After spawning all teammates, you MUST output the EXACT team overview shown at the bottom of this file. No changes, no additions.\n`;
  cmd += `5. Do NOTHING else. Do not explore the codebase. Do not start working. Just spawn and report.\n\n`;

  // Lead identity
  cmd += `## Team lead\n\n`;
  cmd += `You are the lead of team "${team.name}". Your role: ${lead.role || "(unset)"}`;
  if (lead.instructions) cmd += `. ${lead.instructions}`;
  cmd += `\n`;
  if (leadProfile.customClaudeMd) {
    cmd += `\nProfile instructions:\n${leadProfile.customClaudeMd}\n`;
  }
  cmd += `\n`;

  // Spawn prompts
  cmd += `## Spawn prompts (copy verbatim)\n\n`;

  for (const member of nonLeadMembers) {
    const addOns = ownedAddOns.get(member.profile) ?? { skills: [], agents: [], commands: [] };
    const memberProfile = memberProfiles.find((mp) => mp.member.profile === member.profile)?.profile;
    const slug = slugify(member.profile);
    const toolLines = formatToolLines(addOns);
    const toolBlock = toolLines.length > 0 ? toolLines.join("\n") : "(none)";

    cmd += `### Teammate: ${slug}\n\n`;
    cmd += `Name this teammate exactly: \`${slug}\`\n\n`;
    cmd += `Copy this spawn prompt verbatim (everything between the ~~~ markers):\n\n`;
    cmd += `~~~\n`;
    cmd += `You are "${slug}" on team "${team.name}".\n`;
    cmd += `Role: ${member.role || "(unset)"}\n`;
    if (member.instructions) cmd += `Instructions: ${member.instructions}\n`;
    cmd += `\n`;
    if (memberProfile?.customClaudeMd) {
      cmd += `Profile instructions (follow strictly):\n${memberProfile.customClaudeMd}\n\n`;
    }
    cmd += `Your available tools:\n${toolBlock}\n`;
    cmd += `\n`;
    cmd += `You may ONLY use the tools listed above. If you need a tool not in your list, message the team lead and they will delegate to the correct teammate.\n`;
    cmd += `\n`;
    cmd += `YOUR FIRST OUTPUT must be exactly this (no changes):\n`;
    cmd += `\n`;
    cmd += `**${slug}**\n`;
    cmd += `Role: ${member.role || "(unset)"}\n`;
    cmd += `Tools:\n`;
    for (const line of toolLines) {
      cmd += `- ${line}\n`;
    }
    if (toolLines.length === 0) cmd += `- (none)\n`;
    cmd += `Ready.\n`;
    cmd += `\n`;
    cmd += `After printing the above, stop and wait for work from the team lead. Do not take any other action.\n`;
    cmd += `~~~\n\n`;
  }

  // Lead's required output — includes their own tool announcement
  const leadAddOns = ownedAddOns.get(lead.profile) ?? { skills: [], agents: [], commands: [] };
  const leadToolLines = formatToolLines(leadAddOns);

  cmd += `## Your required output (print exactly this after all teammates are spawned)\n\n`;
  cmd += `~~~\n`;
  cmd += `**Team: ${team.name}** (${team.members.length} members)\n\n`;
  cmd += `**${slugify(lead.profile)}** (lead)\n`;
  cmd += `Role: ${lead.role || "(you)"}\n`;
  cmd += `Tools:\n`;
  for (const line of leadToolLines) {
    cmd += `- ${line}\n`;
  }
  if (leadToolLines.length === 0) cmd += `- (none)\n`;
  cmd += `\n`;
  for (const member of nonLeadMembers) {
    const slug = slugify(member.profile);
    cmd += `${slug}: ${member.role || "(no role set)"}\n`;
  }
  cmd += `\nAll teammates ready. What are we working on?\n`;
  cmd += `~~~\n`;

  return cmd;
}
