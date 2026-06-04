import React from "react";
import { useTranslation } from "react-i18next";
import type { MergePreview as MergePreviewType } from "../../electron/types";

interface Props {
  data: MergePreviewType;
  onClose: () => void;
}

export function MergePreview({ data, onClose }: Props) {
  const { t } = useTranslation(["team", "common"]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog modal-dialog--wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{t("team:merge.title")}</span>
          <button className="modal-close" onClick={onClose}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="modal-body mp-body">
          {/* Combined Plugins */}
          <div className="mp-section">
            <div className="pm-label">{t("team:merge.combinedPlugins", { count: data.plugins.length })}</div>
            <div className="mp-list">
              {data.plugins.map((p) => (
                <span key={p} className="plugin-badge">{p.split("@")[0]}</span>
              ))}
              {data.plugins.length === 0 && (
                <span className="te-avail-meta">{t("team:merge.noPlugins")}</span>
              )}
            </div>
          </div>

          {/* Agent Definitions */}
          {data.agents.length > 0 && (
            <div className="mp-section">
              <div className="pm-label">{t("team:merge.members", { count: data.agents.length })}</div>
              <div className="mp-agents">
                {data.agents.map((a) => (
                  <div key={a.profile} className="mp-agent">
                    <div className="mp-agent-header">
                      <span className="mp-agent-name">{a.name || a.profile}</span>
                      <span className="mp-agent-source">{t("team:merge.from", { profile: a.profile })}</span>
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
            <div className="pm-label">{t("team:merge.settings", { source: data.settings.source })}</div>
            <div className="mp-settings">
              {data.settings.model && <div>{t("team:merge.model", { model: data.settings.model })}</div>}
              {data.settings.effortLevel && <div>{t("team:merge.effort", { level: data.settings.effortLevel })}</div>}
              {data.settings.customFlags && <div>{t("team:merge.flags", { flags: data.settings.customFlags })}</div>}
              {!data.settings.model && !data.settings.effortLevel && !data.settings.customFlags && (
                <div className="te-avail-meta">{t("common:labels.defaultSettings")}</div>
              )}
            </div>
          </div>

          {/* Conflicts */}
          {data.conflicts.length > 0 && (
            <div className="mp-section">
              <div className="pm-label" style={{ color: "var(--color-danger)" }}>{t("team:merge.conflicts", { count: data.conflicts.length })}</div>
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
