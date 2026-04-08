import React, { useState, useEffect, useRef } from "react";

interface DiagResult {
  version: string;
  configDir: string;
  claudeHome: string;
  profileCount: number;
  teamCount: number;
  issues: string[];
}

function applyScale(scale: number) {
  document.documentElement.style.fontSize = `${13 * scale}px`;
}

interface Props {
  onClose: () => void;
}

export function AppSettingsDialog({ onClose }: Props) {
  const [scale, setScale] = useState(1);
  const [diag, setDiag] = useState<DiagResult | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    window.api.getAppPreferences().then((p) => {
      setScale(p.fontSize ?? 1);
    });
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleScaleChange = (newScale: number) => {
    setScale(newScale);
    applyScale(newScale);
    window.api.saveAppPreferences({ fontSize: newScale });
  };

  const handleRunDiagnostics = async () => {
    setDiagLoading(true);
    const result = await window.api.runDiagnostics();
    setDiag(result);
    setDiagLoading(false);
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="manage-dialog app-settings-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="App Settings"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="manage-dialog-header">
          <span style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-primary)" }}>App Settings</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="app-settings-body">
          {/* Text Size */}
          <div className="manage-section">
            <div className="manage-section-header">
              <span className="manage-section-label">Text Size</span>
            </div>
            <div className="text-size-slider">
              <span className="text-size-label-sm">A</span>
              <input
                type="range"
                min={0.85}
                max={1.2}
                step={0.05}
                value={scale}
                onChange={(e) => handleScaleChange(Number(e.target.value))}
              />
              <span className="text-size-label-lg">A</span>
            </div>
          </div>

          {/* Diagnostics */}
          <div className="manage-section">
            <div className="manage-section-header">
              <span className="manage-section-label">Diagnostics</span>
              <button className="btn-secondary" style={{ fontSize: "0.846rem", padding: "3px 10px" }} onClick={handleRunDiagnostics} disabled={diagLoading}>
                {diagLoading ? "Running..." : "Run Check"}
              </button>
            </div>
            {diag ? (
              <div className="modal-fields" style={{ marginTop: "8px" }}>
                <div className="field">
                  <label>App Version</label>
                  <div className="field-hint" style={{ margin: 0 }}>{diag.version}</div>
                </div>
                <div className="field-divider" />
                <div className="field">
                  <label>Config Directory</label>
                  <div className="field-hint" style={{ margin: 0, fontFamily: '"SF Mono", monospace', fontSize: "0.846rem" }}>{diag.configDir}</div>
                </div>
                <div className="field">
                  <label>Claude Home</label>
                  <div className="field-hint" style={{ margin: 0, fontFamily: '"SF Mono", monospace', fontSize: "0.846rem" }}>{diag.claudeHome}</div>
                </div>
                <div className="field-divider" />
                <div className="field">
                  <label>Summary</label>
                  <div className="field-hint" style={{ margin: 0 }}>
                    {diag.profileCount} profile{diag.profileCount !== 1 ? "s" : ""}, {diag.teamCount} team{diag.teamCount !== 1 ? "s" : ""}
                  </div>
                </div>
                <div className="field-divider" />
                <div className="field">
                  <label>Health</label>
                  {diag.issues.length === 0 ? (
                    <div style={{ fontSize: "0.923rem", color: "var(--color-skill)" }}>All checks passed</div>
                  ) : (
                    <div className="diag-issues">
                      {diag.issues.map((issue, i) => (
                        <div key={i} className="diag-issue">
                          <span style={{ color: "var(--color-danger)" }}>{"\u26A0"}</span> {issue}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="manage-section-hint">Click "Run Check" to verify config directories, symlinks, and settings.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
