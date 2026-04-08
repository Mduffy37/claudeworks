import React, { useState, useEffect, useRef } from "react";

interface DiagResult {
  version: string;
  configDir: string;
  claudeHome: string;
  profileCount: number;
  teamCount: number;
  issues: string[];
}

type ThemeMode = "dark" | "light" | "auto";

function applyScale(scale: number) {
  document.documentElement.style.fontSize = `${13 * scale}px`;
}

function getSystemTheme(): "dark" | "light" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(mode: ThemeMode) {
  const resolved = mode === "auto" ? getSystemTheme() : mode;
  document.documentElement.setAttribute("data-theme", resolved);
}

interface Props {
  onClose: () => void;
}

export function AppSettingsDialog({ onClose }: Props) {
  const [scale, setScale] = useState(1);
  const [theme, setTheme] = useState<ThemeMode>("dark");
  const [diag, setDiag] = useState<DiagResult | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    window.api.getAppPreferences().then((p: any) => {
      setScale(p.fontSize ?? 1);
      setTheme(p.theme ?? "dark");
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
    window.api.saveAppPreferences({ fontSize: newScale, theme } as any);
  };

  const handleThemeChange = (mode: ThemeMode) => {
    setTheme(mode);
    applyTheme(mode);
    window.api.saveAppPreferences({ fontSize: scale, theme: mode } as any);
  };

  // Listen for system theme changes when auto
  useEffect(() => {
    if (theme !== "auto") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("auto");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

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
          {/* Theme */}
          <div className="manage-section">
            <div className="manage-section-header">
              <span className="manage-section-label">Theme</span>
            </div>
            <div className="theme-options">
              {(["light", "dark", "auto"] as const).map((mode) => (
                <button
                  key={mode}
                  className={`theme-option${theme === mode ? " active" : ""}`}
                  onClick={() => handleThemeChange(mode)}
                >
                  {mode === "light" && <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.2"/><path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.8 3.8l1 1M11.2 11.2l1 1M3.8 12.2l1-1M11.2 4.8l1-1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/></svg>}
                  {mode === "dark" && <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M13.4 10.4A6 6 0 015.6 2.6a6 6 0 107.8 7.8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/></svg>}
                  {mode === "auto" && <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2"/><path d="M8 3v10" stroke="currentColor" strokeWidth="1.2"/></svg>}
                  <span>{mode.charAt(0).toUpperCase() + mode.slice(1)}</span>
                </button>
              ))}
            </div>
          </div>

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
