export type WidgetOptionType = "boolean" | "number" | "select" | "text";

export interface WidgetOptionSchema {
  key: string;
  label: string;
  type: WidgetOptionType;
  default: unknown;
  choices?: { value: string; label: string }[];
  min?: number;
  max?: number;
}

export interface WidgetSchema {
  id: string;
  label: string;
  description: string;
  options: WidgetOptionSchema[];
}

export const WIDGET_SCHEMAS: Record<string, WidgetSchema> = {
  time: { id: "time", label: "Current time", description: "Wall-clock time in HH:MM format.", options: [] },
  model: { id: "model", label: "Model name", description: "Active model display name, prefixed by 'Claude '.", options: [] },
  context: {
    id: "context",
    label: "Context window bar",
    description: "Progress bar showing how much of the context window is used.",
    options: [
      { key: "showBar", label: "Show progress bar", type: "boolean", default: true },
      { key: "barWidth", label: "Bar width (characters)", type: "number", default: 15, min: 5, max: 30 },
    ],
  },
  git: {
    id: "git",
    label: "Git branch",
    description: "Current branch with dirty file count and unpushed commit count.",
    options: [
      { key: "showUnpushed", label: "Show unpushed commits", type: "boolean", default: true },
      { key: "showDirty", label: "Show dirty file count", type: "boolean", default: true },
    ],
  },
  lines: { id: "lines", label: "Lines added / removed", description: "Session-level lines changed across all edits.", options: [] },
  uptime: { id: "uptime", label: "Session uptime", description: "Elapsed time since the session started.", options: [] },
  cost: {
    id: "cost",
    label: "Session cost",
    description: "Cumulative cost of the current session.",
    options: [
      {
        key: "currency",
        label: "Currency",
        type: "select",
        default: "GBP",
        choices: [
          { value: "USD", label: "USD ($)" },
          { value: "GBP", label: "GBP (£)" },
          { value: "EUR", label: "EUR (€)" },
        ],
      },
    ],
  },
  usage5h: {
    id: "usage5h",
    label: "5-hour rate limit",
    description: "Current 5h window utilization with optional reset countdown and risk-tier coloring.",
    options: [
      { key: "showReset", label: "Show reset countdown", type: "boolean", default: true },
      { key: "showTier", label: "Color by risk tier", type: "boolean", default: true },
    ],
  },
  usage7d: { id: "usage7d", label: "7-day rate limit", description: "Current 7d window utilization.", options: [] },
};
