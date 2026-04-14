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

export function StatusBarTab() {
  const [config, setConfig] = useState<StatusLineConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

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

  function changeOption(sectionId: string, widgetId: string, key: string, value: unknown) {
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
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="status-bar-tab">
      <header className="status-bar-tab-header">
        <h2>Status Bar Widgets</h2>
        <p className="status-bar-tab-hint">
          Toggle widgets on or off to customize your Claude Code status line.
          Changes apply on the next Claude Code session restart.
        </p>
      </header>

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
                      onToggle={(enabled) => toggleWidget(section.id, widget.id, enabled)}
                      onOptionChange={(key, value) => changeOption(section.id, widget.id, key, value)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </section>
          ))}
        </div>
      </DndContext>

      <StatusBarPreview config={config} />

      <footer className="status-bar-tab-footer">
        <button className="btn-secondary" disabled={saving} onClick={handleReset}>
          Reset to defaults
        </button>
        <button className="btn-primary" disabled={!dirty || saving} onClick={handleSave}>
          {saving ? "Saving…" : dirty ? "Save" : "Saved"}
        </button>
      </footer>
    </div>
  );
}
