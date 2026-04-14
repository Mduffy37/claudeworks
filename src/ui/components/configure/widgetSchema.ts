export type WidgetOptionType = "boolean" | "number" | "select" | "text" | "color";

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

// Default primary color for every widget is MC blue — matches the Python
// `CB` constant (\033[1;38;2;108;171;221m). Users can override per-widget
// via the color picker; the `color` option is always the FIRST entry so
// the expand chevron appears uniformly across every widget.
const DEFAULT_PRIMARY = "#6cabdd";

export const WIDGET_SCHEMAS: Record<string, WidgetSchema> = {
  time: {
    id: "time",
    label: "Current time",
    description: "Wall-clock time display. Try ⏰ as an icon.",
    options: [
      { key: "color", label: "Primary color", type: "color", default: DEFAULT_PRIMARY },
      { key: "icon", label: "Icon/prefix", type: "text", default: "" },
      {
        key: "format",
        label: "Time format",
        type: "select",
        default: "24h",
        choices: [
          { value: "24h", label: "24-hour (13:45)" },
          { value: "12h", label: "12-hour (1:45 PM)" },
        ],
      },
      { key: "showSeconds", label: "Show seconds", type: "boolean", default: false },
    ],
  },
  model: {
    id: "model",
    label: "Model name",
    description: "Active model display name, prefixed by 'Claude '. Try 🤖 as an icon.",
    options: [
      { key: "color", label: "Primary color", type: "color", default: DEFAULT_PRIMARY },
      { key: "icon", label: "Icon/prefix", type: "text", default: "" },
    ],
  },
  context: {
    id: "context",
    label: "Context window bar",
    description: "Progress bar showing how much of the context window is used. Try 📊 as an icon.",
    options: [
      { key: "color", label: "Primary color", type: "color", default: DEFAULT_PRIMARY },
      { key: "icon", label: "Icon/prefix", type: "text", default: "" },
      { key: "showBar", label: "Show progress bar", type: "boolean", default: true },
      { key: "barWidth", label: "Bar width (characters)", type: "number", default: 15, min: 5, max: 30 },
      {
        key: "barStyle",
        label: "Bar style",
        type: "select",
        default: "block",
        choices: [
          { value: "block", label: "Block (█░)" },
          { value: "heavy", label: "Heavy (━╌)" },
          { value: "light", label: "Light (─·)" },
          { value: "dots", label: "Dots (●○)" },
        ],
      },
    ],
  },
  git: {
    id: "git",
    label: "Git branch",
    description: "Current branch with dirty file count and unpushed commit count. Try 🌿 as an icon.",
    options: [
      { key: "color", label: "Primary color", type: "color", default: DEFAULT_PRIMARY },
      { key: "icon", label: "Icon/prefix", type: "text", default: "" },
      { key: "showUnpushed", label: "Show unpushed commits", type: "boolean", default: true },
      { key: "showDirty", label: "Show dirty file count", type: "boolean", default: true },
    ],
  },
  lines: {
    id: "lines",
    label: "Lines added / removed",
    description: "Session-level lines changed across all edits. Try ✏️ as an icon. (Added/removed colors are fixed green/red and cannot be overridden.)",
    options: [
      { key: "icon", label: "Icon/prefix", type: "text", default: "" },
    ],
  },
  uptime: {
    id: "uptime",
    label: "Session uptime",
    description: "Elapsed time since the session started. Try ⏱ as an icon.",
    options: [
      { key: "color", label: "Primary color", type: "color", default: DEFAULT_PRIMARY },
      { key: "icon", label: "Icon/prefix", type: "text", default: "" },
    ],
  },
  cost: {
    id: "cost",
    label: "Session cost",
    description: "Cumulative cost of the current session. Try 💰 as an icon.",
    options: [
      { key: "color", label: "Primary color", type: "color", default: DEFAULT_PRIMARY },
      { key: "icon", label: "Icon/prefix", type: "text", default: "" },
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
    description: "Current 5h window utilization with optional reset countdown and risk-tier coloring. Try ⚡ as an icon.",
    options: [
      { key: "color", label: "Primary color", type: "color", default: DEFAULT_PRIMARY },
      { key: "icon", label: "Icon/prefix", type: "text", default: "" },
      { key: "showReset", label: "Show reset countdown", type: "boolean", default: true },
      { key: "showTier", label: "Color by risk tier", type: "boolean", default: true },
    ],
  },
  usage7d: {
    id: "usage7d",
    label: "7-day rate limit",
    description: "Current 7d window utilization with optional reset countdown and risk-tier coloring. Try 📅 as an icon.",
    options: [
      { key: "color", label: "Primary color", type: "color", default: DEFAULT_PRIMARY },
      { key: "icon", label: "Icon/prefix", type: "text", default: "" },
      { key: "showReset", label: "Show reset countdown", type: "boolean", default: false },
      { key: "showTier", label: "Color by risk tier", type: "boolean", default: false },
    ],
  },
};
