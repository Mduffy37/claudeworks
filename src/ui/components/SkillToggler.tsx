import React, { useMemo } from "react";
import type { PluginItem, PluginWithItems } from "../../../src/electron/types";

interface Props {
  items: PluginItem[];
  allPlugins: PluginWithItems[];
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

function resolveAllDeps(
  item: PluginItem,
  allPlugins: PluginWithItems[],
  visited: Set<string> = new Set()
): string[] {
  const result: string[] = [];
  for (const dep of item.dependencies) {
    if (visited.has(dep)) continue;
    visited.add(dep);
    result.push(dep);
    const [refPlugin, refItem] = dep.split(":");
    const plugin = allPlugins.find(
      (p) => p.pluginName === refPlugin || p.name.startsWith(refPlugin + "@")
    );
    const depItemObj = plugin?.items.find((i) => i.name === refItem);
    if (depItemObj) {
      result.push(...resolveAllDeps(depItemObj, allPlugins, visited));
    }
  }
  return result;
}

export function SkillToggler({ items, allPlugins, pluginEnabled, excludedNames, onToggle }: Props) {
  if (items.length === 0) {
    return <div className="skill-toggler-empty">No items found</div>;
  }

  // Pre-compute full dependency chains
  const depMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const item of items) {
      if (item.dependencies.length > 0) {
        map.set(item.name, resolveAllDeps(item, allPlugins));
      }
    }
    return map;
  }, [items, allPlugins]);

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
                  {item.dependencies.length > 0 && (
                    <span
                      className="skill-badge deps"
                      title={"Requires:\n" + (depMap.get(item.name) ?? []).join("\n")}
                    >
                      has deps
                    </span>
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
