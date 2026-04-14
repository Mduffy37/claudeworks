import React, { useEffect, useState } from "react";
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
import type { StatusLineConfig } from "../../../electron/types";
import { SortableWidgetRow } from "./SortableWidgetRow";
import { WidgetOptionsPanel } from "./WidgetOptionsPanel";
import { StatusBarPreview } from "./StatusBarPreview";

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
};

interface SelectedWidget {
  sectionId: string;
  widgetId: string;
}

export function StatusBarTab() {
  const [config, setConfig] = useState<StatusLineConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [selectedWidget, setSelectedWidget] = useState<SelectedWidget | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  useEffect(() => {
    window.api.getStatusLineConfig().then(setConfig);
  }, []);

  if (!config) {
    return <div className="status-bar-tab loading">Loading status bar config…</div>;
  }

  function toggleWidget(sectionId: string, widgetId: string, enabled: boolean) {
    if (!config) return;
    const next = JSON.parse(JSON.stringify(config)) as StatusLineConfig;
    const sec = next.sections.find((s) => s.id === sectionId);
    if (!sec) return;
    const w = sec.widgets.find((x) => x.id === widgetId);
    if (!w) return;
    w.enabled = enabled;
    setConfig(next);
    setDirty(true);
  }

  function changeOption(
    sectionId: string,
    widgetId: string,
    key: string,
    value: unknown,
  ) {
    if (!config) return;
    const next = JSON.parse(JSON.stringify(config)) as StatusLineConfig;
    const sec = next.sections.find((s) => s.id === sectionId);
    if (!sec) return;
    const w = sec.widgets.find((x) => x.id === widgetId);
    if (!w) return;
    w.options = { ...w.options, [key]: value };
    setConfig(next);
    setDirty(true);
  }

  function changeSelectedOption(key: string, value: unknown) {
    if (!selectedWidget) return;
    changeOption(selectedWidget.sectionId, selectedWidget.widgetId, key, value);
  }

  function handleDragEnd(event: DragEndEvent) {
    if (!config) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const [fromSection, fromWidget] = String(active.id).split(":");
    const [toSection, toWidget] = String(over.id).split(":");

    const next: StatusLineConfig = JSON.parse(JSON.stringify(config));
    const fromSec = next.sections.find((s) => s.id === fromSection);
    const toSec = next.sections.find((s) => s.id === toSection);
    if (!fromSec || !toSec) return;

    const fromIdx = fromSec.widgets.findIndex((w) => w.id === fromWidget);
    const toIdx = toSec.widgets.findIndex((w) => w.id === toWidget);
    if (fromIdx === -1 || toIdx === -1) return;

    if (fromSection === toSection) {
      fromSec.widgets = arrayMove(fromSec.widgets, fromIdx, toIdx);
    } else {
      const [moved] = fromSec.widgets.splice(fromIdx, 1);
      toSec.widgets.splice(toIdx, 0, moved);
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

  async function handleReset() {
    setSaving(true);
    try {
      const fresh = await window.api.resetStatusLineConfig();
      setConfig(fresh);
      setDirty(false);
      setSelectedWidget(null);
    } finally {
      setSaving(false);
    }
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

  // Find the selected widget's current object (for rendering the inspector).
  const selectedWidgetObj = selectedWidget
    ? config.sections
        .find((s) => s.id === selectedWidget.sectionId)
        ?.widgets.find((w) => w.id === selectedWidget.widgetId)
    : null;

  const selectedWidgetLabel = selectedWidget
    ? WIDGET_LABELS[selectedWidget.widgetId] ?? selectedWidget.widgetId
    : null;

  return (
    <div className="status-bar-tab">
      <header className="status-bar-tab-header">
        <h2>Status Bar Widgets</h2>
        <p className="status-bar-tab-hint">
          Click a widget on the left to configure it in the inspector. Drag to
          reorder. Changes apply on the next Claude Code session restart.
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

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <div className="status-bar-tab-sections">
              {config.sections.map((section) => (
                <section key={section.id} className="status-bar-section">
                  <h3 className="status-bar-section-label">{section.label}</h3>
                  <SortableContext
                    items={section.widgets.map((w) => `${section.id}:${w.id}`)}
                    strategy={verticalListSortingStrategy}
                  >
                    <ul className="status-bar-widget-list">
                      {section.widgets.map((widget) => (
                        <SortableWidgetRow
                          key={`${section.id}:${widget.id}`}
                          sectionId={section.id}
                          widget={widget}
                          label={WIDGET_LABELS[widget.id] ?? widget.id}
                          selected={
                            selectedWidget?.sectionId === section.id &&
                            selectedWidget?.widgetId === widget.id
                          }
                          onToggle={(enabled) => toggleWidget(section.id, widget.id, enabled)}
                          onSelect={() =>
                            setSelectedWidget({ sectionId: section.id, widgetId: widget.id })
                          }
                        />
                      ))}
                    </ul>
                  </SortableContext>
                </section>
              ))}
            </div>
          </DndContext>
        </div>

        <div className="status-bar-editor-column">
          <StatusBarPreview config={config} />

          <section className="status-bar-inspector">
            <h3 className="status-bar-inspector-label">Inspector</h3>
            {selectedWidgetObj && selectedWidgetLabel ? (
              <>
                <div className="status-bar-inspector-title">{selectedWidgetLabel}</div>
                <WidgetOptionsPanel
                  widgetId={selectedWidget!.widgetId}
                  options={selectedWidgetObj.options}
                  onChange={changeSelectedOption}
                />
              </>
            ) : (
              <p className="status-bar-inspector-empty">
                Select a widget on the left to configure it.
              </p>
            )}
          </section>

          <footer className="status-bar-tab-footer">
            <button className="btn-secondary" disabled={saving} onClick={handleReset}>
              Reset to defaults
            </button>
            <button className="btn-primary" disabled={!dirty || saving} onClick={handleSave}>
              {saving ? "Saving…" : dirty ? "Save" : "Saved"}
            </button>
          </footer>
        </div>
      </div>
    </div>
  );
}
