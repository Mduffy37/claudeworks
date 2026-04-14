import React, { useEffect, useState } from "react";
import type { StatusLineConfig } from "../../../electron/types";

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

      <div className="status-bar-tab-sections">
        {config.sections.map((section) => (
          <section key={section.id} className="status-bar-section">
            <h3 className="status-bar-section-label">{section.label}</h3>
            <ul className="status-bar-widget-list">
              {section.widgets.map((widget) => (
                <li key={widget.id} className="status-bar-widget-row">
                  <label>
                    <input
                      type="checkbox"
                      checked={widget.enabled}
                      onChange={(e) => toggleWidget(section.id, widget.id, e.target.checked)}
                    />
                    <span className="status-bar-widget-name">
                      {WIDGET_LABELS[widget.id] ?? widget.id}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

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
