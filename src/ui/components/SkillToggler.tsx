import React from "react";
import type { PluginItem } from "../../../src/electron/types";

interface Props {
  items: PluginItem[];
  pluginEnabled: boolean;
  excludedNames: string[];
  onToggle: (itemName: string, enabled: boolean) => void;
}

const TYPE_LABELS: Record<string, string> = {
  skill: "Skill",
  agent: "Agent",
  command: "Command",
};

const TYPE_COLORS: Record<string, string> = {
  skill: "var(--color-skill)",
  agent: "var(--color-agent)",
  command: "var(--color-command)",
};

export function SkillToggler({ items, pluginEnabled, excludedNames, onToggle }: Props) {
  if (items.length === 0) {
    return <div className="skill-toggler-empty">No items found</div>;
  }

  const grouped = {
    skill: items.filter((i) => i.type === "skill"),
    agent: items.filter((i) => i.type === "agent"),
    command: items.filter((i) => i.type === "command"),
  };

  return (
    <div className="skill-toggler">
      {(["skill", "agent", "command"] as const).map((type) => {
        const group = grouped[type];
        if (group.length === 0) return null;
        return (
          <div key={type} className="skill-group">
            <div className="skill-group-label" style={{ color: TYPE_COLORS[type] }}>
              {TYPE_LABELS[type]}s ({group.length})
            </div>
            {group.map((item) => {
              const enabled = pluginEnabled && !excludedNames.includes(item.name);
              return (
                <label key={item.name} className="skill-item">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => onToggle(item.name, e.target.checked)}
                  />
                  <span className="skill-name">
                    {item.type === "command" ? `/${item.name}` : item.name}
                  </span>
                  {!item.userInvocable && (
                    <span className="skill-badge internal">internal</span>
                  )}
                </label>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
