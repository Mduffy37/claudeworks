import React, { useEffect, useRef, useState } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from "@dnd-kit/sortable";
import type { StatusLineConfig, StatusLineWidget } from "../../../electron/types";
import { SortableWidgetRow } from "./SortableWidgetRow";
import { WidgetOptionsPanel } from "./WidgetOptionsPanel";
import { StatusBarPreview } from "./StatusBarPreview";
import { WIDGET_SCHEMAS } from "./widgetSchema";
import { ConfirmDialog } from "../shared/ConfirmDialog";

const WIDGET_LABELS: Record<string, string> = {
  time: "Current time",
  model: "Model name",
  context: "Context window bar",
  git: "Git branch + dirty/unpushed",
  lines: "Lines added / removed",
  uptime: "Session uptime",
  cost: "Session cost",
  usage5h: "5-hour rate limit",
  usage7d: "7-day rate limit",
  // Phase 7:
  cwd: "Working directory",
  gitAge: "Git last commit age",
  profile: "Active profile",
  plugins: "Plugin count",
  burn: "Burn rate ($/min)",
  limitEta: "Rate limit time-to-full",
  // Special:
  break: "— Section break —",
};

// Named starter presets available from the Load preset dropdown. Each is
// a complete StatusLineConfig — picking one replaces the current config.
const PRESETS: Record<string, { label: string; config: StatusLineConfig }> = {
  minimal: {
    label: "Minimal",
    config: {
      version: 2,
      separators: { field: "│", section: "║" },
      widgets: [
        { id: "model", enabled: true, options: {} },
        { id: "context", enabled: true, options: {} },
      ],
    },
  },
  full: {
    label: "Full",
    config: {
      version: 2,
      separators: { field: "│", section: "║" },
      widgets: [
        { id: "time", enabled: true, options: {} },
        { id: "model", enabled: true, options: {} },
        { id: "context", enabled: true, options: {} },
        { id: "break", enabled: true, options: {} },
        { id: "git", enabled: true, options: {} },
        { id: "lines", enabled: true, options: {} },
        { id: "break", enabled: true, options: {} },
        { id: "uptime", enabled: true, options: {} },
        { id: "cost", enabled: true, options: { currency: "GBP" } },
        { id: "usage5h", enabled: true, options: { showReset: true, showTier: true } },
        { id: "usage7d", enabled: true, options: {} },
      ],
    },
  },
  devFocus: {
    label: "Dev focus",
    config: {
      version: 2,
      separators: { field: "│", section: "║" },
      widgets: [
        { id: "model", enabled: true, options: {} },
        { id: "break", enabled: true, options: {} },
        { id: "git", enabled: true, options: {} },
        { id: "lines", enabled: true, options: {} },
        { id: "break", enabled: true, options: {} },
        { id: "cost", enabled: true, options: { currency: "GBP" } },
      ],
    },
  },
  limitsWatcher: {
    label: "Limits watcher",
    config: {
      version: 2,
      separators: { field: "│", section: "║" },
      widgets: [
        { id: "model", enabled: true, options: {} },
        { id: "break", enabled: true, options: {} },
        { id: "usage5h", enabled: true, options: { showReset: true, showTier: true } },
        { id: "usage7d", enabled: true, options: { showTier: true } },
        { id: "burn", enabled: true, options: { currency: "GBP" } },
      ],
    },
  },
};

function getLabel(widgetId: string): string {
  return WIDGET_LABELS[widgetId] ?? widgetId;
}

function dragIdFor(widget: StatusLineWidget, idx: number): string {
  return `widget-${idx}-${widget.id}`;
}

function parseDragIndex(id: string): number {
  const match = id.match(/^widget-(\d+)-/);
  return match ? parseInt(match[1], 10) : -1;
}

export function StatusBarTab() {
  const [config, setConfig] = useState<StatusLineConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);

  const addMenuRef = useRef<HTMLDivElement | null>(null);
  const presetMenuRef = useRef<HTMLDivElement | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  useEffect(() => {
    window.api.getStatusLineConfig().then(setConfig);
  }, []);

  // Close popover menus when clicking outside them.
  useEffect(() => {
    if (!addMenuOpen && !presetMenuOpen) return;
    function handler(e: MouseEvent) {
      const t = e.target as Node;
      if (addMenuOpen && addMenuRef.current && !addMenuRef.current.contains(t)) {
        setAddMenuOpen(false);
      }
      if (presetMenuOpen && presetMenuRef.current && !presetMenuRef.current.contains(t)) {
        setPresetMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [addMenuOpen, presetMenuOpen]);

  if (!config) {
    return <div className="status-bar-tab loading">Loading status bar config…</div>;
  }

  function changeOption(idx: number, key: string, value: unknown) {
    if (!config) return;
    const next = JSON.parse(JSON.stringify(config)) as StatusLineConfig;
    const w = next.widgets[idx];
    if (!w) return;
    w.options = { ...(w.options ?? {}), [key]: value };
    setConfig(next);
    setDirty(true);
  }

  function changeSelectedOption(key: string, value: unknown) {
    if (selectedIndex === null) return;
    changeOption(selectedIndex, key, value);
  }

  function deleteWidget(idx: number) {
    if (!config) return;
    const next = JSON.parse(JSON.stringify(config)) as StatusLineConfig;
    next.widgets.splice(idx, 1);
    setConfig(next);
    setDirty(true);
    // Fix up selection to follow the deletion.
    if (selectedIndex === idx) {
      setSelectedIndex(null);
    } else if (selectedIndex !== null && selectedIndex > idx) {
      setSelectedIndex(selectedIndex - 1);
    }
  }

  function addWidget(widgetId: string) {
    if (!config) return;
    const next = JSON.parse(JSON.stringify(config)) as StatusLineConfig;
    next.widgets.push({ id: widgetId, enabled: true, options: {} });
    setConfig(next);
    setDirty(true);
    setAddMenuOpen(false);
    // Auto-select the new widget (unless it's a break — breaks have no
    // options so there's nothing to configure in the inspector).
    if (widgetId !== "break") {
      setSelectedIndex(next.widgets.length - 1);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    if (!config) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const fromIdx = parseDragIndex(String(active.id));
    const toIdx = parseDragIndex(String(over.id));
    if (fromIdx === -1 || toIdx === -1) return;

    const next = JSON.parse(JSON.stringify(config)) as StatusLineConfig;
    next.widgets = arrayMove(next.widgets, fromIdx, toIdx);

    // Keep the selection pointer on the same logical widget across the move.
    if (selectedIndex !== null) {
      if (selectedIndex === fromIdx) {
        setSelectedIndex(toIdx);
      } else if (fromIdx < selectedIndex && selectedIndex <= toIdx) {
        setSelectedIndex(selectedIndex - 1);
      } else if (toIdx <= selectedIndex && selectedIndex < fromIdx) {
        setSelectedIndex(selectedIndex + 1);
      }
    }

    setConfig(next);
    setDirty(true);
  }

  async function handleSave() {
    if (!config) return;
    setSaving(true);
    try {
      await window.api.setStatusLineConfig(config);
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }

  function handleClearAll() {
    setConfirmClear(false);
    const cleared: StatusLineConfig = {
      version: 2,
      separators: config?.separators ?? { field: "│", section: "║" },
      widgets: [{ id: "model", enabled: true, options: {} }],
    };
    setConfig(cleared);
    setSelectedIndex(null);
    setDirty(true);
  }

  function loadPreset(key: keyof typeof PRESETS) {
    const preset = PRESETS[key];
    if (!preset) return;
    // Deep-clone so edits don't mutate the PRESETS table.
    setConfig(JSON.parse(JSON.stringify(preset.config)) as StatusLineConfig);
    setSelectedIndex(null);
    setDirty(true);
    setPresetMenuOpen(false);
  }

  function changeSeparator(which: "field" | "section", value: string) {
    if (!config) return;
    const next = JSON.parse(JSON.stringify(config)) as StatusLineConfig;
    next.separators = { ...(next.separators ?? {}), [which]: value };
    setConfig(next);
    setDirty(true);
  }

  const fieldSep = config.separators?.field ?? "│";
  const sectionSep = config.separators?.section ?? "║";

  const selectedWidgetObj =
    selectedIndex !== null && config.widgets[selectedIndex]
      ? config.widgets[selectedIndex]
      : null;
  const selectedWidgetLabel = selectedWidgetObj
    ? getLabel(selectedWidgetObj.id)
    : null;
  const selectedIsBreak = selectedWidgetObj?.id === "break";

  const widgetMenuEntries = Object.values(WIDGET_SCHEMAS);

  return (
    <div className="status-bar-tab">
      <header className="status-bar-tab-header">
        <h2>Status Bar Widgets</h2>
        <p className="status-bar-tab-hint">
          Click a widget on the left to configure it in the inspector. Drag to
          reorder. Drop in a section break to split a long bar into groups.
          Changes apply on the next Claude Code session restart.
        </p>
      </header>

      <div className="status-bar-split">
        <div className="status-bar-list-column">
          <section className="status-bar-global-options status-bar-section">
            <h3 className="status-bar-section-label">Global</h3>
            <ul className="status-bar-widget-list">
              <li className="status-bar-widget-row">
                <label>
                  <span className="status-bar-widget-name">Field separator</span>
                  <input
                    type="text"
                    value={fieldSep}
                    maxLength={3}
                    onChange={(e) => changeSeparator("field", e.target.value)}
                    className="status-bar-separator-input"
                  />
                </label>
              </li>
              <li className="status-bar-widget-row">
                <label>
                  <span className="status-bar-widget-name">Section separator</span>
                  <input
                    type="text"
                    value={sectionSep}
                    maxLength={3}
                    onChange={(e) => changeSeparator("section", e.target.value)}
                    className="status-bar-separator-input"
                  />
                </label>
              </li>
            </ul>
          </section>

          <section className="status-bar-section">
            <h3 className="status-bar-section-label">Widgets</h3>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={config.widgets.map((w, idx) => dragIdFor(w, idx))}
                strategy={verticalListSortingStrategy}
              >
                <ul className="status-bar-widget-list">
                  {config.widgets.map((widget, idx) => (
                    <SortableWidgetRow
                      key={dragIdFor(widget, idx)}
                      dragId={dragIdFor(widget, idx)}
                      widgetIndex={idx}
                      widget={widget}
                      label={getLabel(widget.id)}
                      selected={selectedIndex === idx}
                      onSelect={() => setSelectedIndex(idx)}
                      onDelete={() => deleteWidget(idx)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>

            <div className="status-bar-add-widget-wrap" ref={addMenuRef}>
              <button
                type="button"
                className="status-bar-add-widget"
                onClick={() => setAddMenuOpen((prev) => !prev)}
              >
                + Add widget
              </button>
              {addMenuOpen && (
                <div className="status-bar-add-menu">
                  <button type="button" onClick={() => addWidget("break")}>
                    — Section break —
                  </button>
                  {widgetMenuEntries.map((schema) => (
                    <button
                      key={schema.id}
                      type="button"
                      onClick={() => addWidget(schema.id)}
                    >
                      {schema.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <div className="status-bar-editor-column">
          <StatusBarPreview config={config} />

          <section className="status-bar-inspector">
            <h3 className="status-bar-inspector-label">Inspector</h3>
            {selectedWidgetObj && selectedWidgetLabel && !selectedIsBreak ? (
              <>
                <div className="status-bar-inspector-title">{selectedWidgetLabel}</div>
                <WidgetOptionsPanel
                  widgetId={selectedWidgetObj.id}
                  options={selectedWidgetObj.options ?? {}}
                  onChange={changeSelectedOption}
                />
              </>
            ) : selectedIsBreak ? (
              <p className="status-bar-inspector-empty">
                Section breaks have no options — they just split widgets into groups.
              </p>
            ) : (
              <p className="status-bar-inspector-empty">
                Select a widget on the left to configure it.
              </p>
            )}
          </section>

          <footer className="status-bar-tab-footer">
            <div className="status-bar-footer-left">
              <button
                className="btn-secondary"
                disabled={saving}
                onClick={() => setConfirmClear(true)}
              >
                Clear all
              </button>
              <div className="status-bar-preset-wrap" ref={presetMenuRef}>
                <button
                  className="btn-secondary"
                  disabled={saving}
                  onClick={() => setPresetMenuOpen((prev) => !prev)}
                >
                  Load preset ▾
                </button>
                {presetMenuOpen && (
                  <div className="status-bar-preset-menu">
                    {Object.entries(PRESETS).map(([key, { label }]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => loadPreset(key as keyof typeof PRESETS)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <button className="btn-primary" disabled={!dirty || saving} onClick={handleSave}>
              {saving ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>
          </footer>
        </div>
      </div>

      {confirmClear && (
        <ConfirmDialog
          title="Clear all widgets?"
          description="Remove all widgets and reset to just the model. This can't be undone."
          confirmLabel="Clear all"
          confirmVariant="danger"
          onConfirm={handleClearAll}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}
