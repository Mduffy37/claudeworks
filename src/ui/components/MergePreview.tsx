import React from "react";
import type { MergePreview as MergePreviewType } from "../../electron/types";

interface Props {
  data: MergePreviewType;
  onClose: () => void;
}

export function MergePreview({ data, onClose }: Props) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Merge Preview</span>
          <button className="modal-close" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="modal-body mp-body">
          {/* Combined Plugins */}
          <div className="mp-section">
            <div className="pm-label">Combined Plugins ({data.plugins.length})</div>
            <div className="mp-list">
              {data.plugins.map((p) => (
                <span key={p} className="plugin-badge">{p.split("@")[0]}</span>
              ))}
              {data.plugins.length === 0 && (
                <span className="te-avail-meta">No plugins</span>
              )}
            </div>
          </div>

          {/* Agent Definitions */}
          {data.agents.length > 0 && (
            <div className="mp-section">
              <div className="pm-label">Members ({data.agents.length})</div>
              <div className="mp-agents">
                {data.agents.map((a) => (
                  <div key={a.profile} className="mp-agent">
                    <div className="mp-agent-header">
                      <span className="mp-agent-name">{a.name || a.profile}</span>
                      <span className="mp-agent-source">from {a.profile}</span>
                    </div>
                    {a.instructions && (
                      <div className="mp-agent-instructions">{a.instructions}</div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Settings */}
          <div className="mp-section">
            <div className="pm-label">Settings ({data.settings.source})</div>
            <div className="mp-settings">
              {data.settings.model && <div>Model: {data.settings.model}</div>}
              {data.settings.effortLevel && <div>Effort: {data.settings.effortLevel}</div>}
              {data.settings.customFlags && <div>Flags: {data.settings.customFlags}</div>}
              {!data.settings.model && !data.settings.effortLevel && !data.settings.customFlags && (
                <div className="te-avail-meta">Default settings</div>
              )}
            </div>
          </div>

          {/* Conflicts */}
          {data.conflicts.length > 0 && (
            <div className="mp-section">
              <div className="pm-label" style={{ color: "var(--color-danger)" }}>Conflicts ({data.conflicts.length})</div>
              <div className="mp-conflicts">
                {data.conflicts.map((c, i) => (
                  <div key={i} className="mp-conflict">{c}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
