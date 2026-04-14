import React, { useEffect, useState } from "react";
import type { DoctorFinding, DoctorReport } from "../../electron/types";

interface Props {
  /**
   * Called after the user clicks "Reload app" following a repair. Parent
   * should call reload() on useProfiles / usePlugins / useTeams so the main
   * UI re-fetches against the now-healed store.
   */
  onReload: () => void;
  /** Close the modal without reloading. */
  onClose: () => void;
  /**
   * If true, the modal was opened because the app is in an error state
   * (hung splash). Changes copy to emphasise recovery. If false, it was
   * opened proactively from App Settings.
   */
  fromErrorState?: boolean;
}

/**
 * Profiles Doctor — diagnostic + repair UI over the new runProfilesDoctor IPC.
 *
 * Flow:
 *   1. Mount → auto-run `detect`. Show a per-check list with severity icons.
 *   2. If any finding has status="detected" and is fixable, show
 *      "Apply Repairs". Click → run `repair`, swap report, show "Reload app".
 *   3. "Reload app" calls onReload() which in the parent calls reload() on
 *      all three load hooks so the main UI re-fetches.
 *
 * Everything destructive happens on an explicit click — mounting the modal
 * never modifies state.
 */
export function DoctorModal({ onReload, onClose, fromErrorState }: Props) {
  const [report, setReport] = useState<DoctorReport | null>(null);
  const [running, setRunning] = useState<"detect" | "repair" | null>("detect");
  const [error, setError] = useState<string | null>(null);
  const [repaired, setRepaired] = useState(false);

  // Auto-run detect on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await window.api.runProfilesDoctor("detect");
        if (!cancelled) {
          setReport(r);
          setRunning(null);
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? String(e));
          setRunning(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Escape to close — but only when not mid-run, to avoid abandoning a repair
  // the user just initiated.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && running === null) onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, running]);

  const handleRepair = async () => {
    setRunning("repair");
    setError(null);
    try {
      const r = await window.api.runProfilesDoctor("repair");
      setReport(r);
      setRepaired(true);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setRunning(null);
    }
  };

  // "Fixable" = at least one detected finding that we know the doctor will
  // act on in repair mode. The doctor's report-only checks (orphan dirs,
  // alias collisions, dangling refs, unfixable) won't change after repair,
  // so we don't offer the button if those are the only findings.
  const hasFixable = !!report?.findings.some((f) => {
    if (f.status !== "detected") return false;
    return (
      f.check === "profiles-file-parseable" ||
      f.check === "profiles-root-shape" ||
      f.check === "profiles-row-integrity" ||
      f.check === "teams-file-parseable" ||
      f.check === "teams-root-shape" ||
      f.check === "stale-bin-aliases"
    );
  });

  const summary = report?.summary;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && running === null) onClose();
      }}
    >
      <div
        className="manage-dialog doctor-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Profiles Doctor"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="manage-dialog-header">
          <div>
            <span style={{ fontSize: "1rem", fontWeight: 600, color: "var(--text-primary)" }}>
              Profiles Doctor
            </span>
            <div className="doctor-subtitle">
              {fromErrorState
                ? "The app couldn't load its data. Run a diagnostic to find and repair the issue."
                : "Check your profiles store and related config files for known issues."}
            </div>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close" disabled={running !== null}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="doctor-body">
          {running === "detect" && (
            <div className="doctor-running">
              <div className="doctor-spinner" />
              <div>Running diagnostic checks…</div>
            </div>
          )}

          {running === "repair" && (
            <div className="doctor-running">
              <div className="doctor-spinner" />
              <div>Applying repairs…</div>
            </div>
          )}

          {error && (
            <div className="doctor-error">
              <strong>Doctor failed:</strong> {error}
            </div>
          )}

          {report && running === null && (
            <>
              {summary && (
                <div className="doctor-summary">
                  <DoctorSummaryChip label="Healthy" count={summary.healthy} kind="healthy" />
                  {summary.fixed > 0 && (
                    <DoctorSummaryChip label="Fixed" count={summary.fixed} kind="fixed" />
                  )}
                  {summary.detected > 0 && (
                    <DoctorSummaryChip label="Detected" count={summary.detected} kind="detected" />
                  )}
                  {summary.unfixable > 0 && (
                    <DoctorSummaryChip label="Unfixable" count={summary.unfixable} kind="unfixable" />
                  )}
                  {summary.skipped > 0 && (
                    <DoctorSummaryChip label="Skipped" count={summary.skipped} kind="skipped" />
                  )}
                </div>
              )}

              <ul className="doctor-finding-list">
                {report.findings.map((f) => (
                  <DoctorFindingRow key={f.check + ":" + f.status} finding={f} />
                ))}
              </ul>
            </>
          )}
        </div>

        <div className="doctor-footer">
          {repaired ? (
            <>
              <span className="doctor-repaired-label">Repairs applied. Reload the app to re-read the healed store.</span>
              <button className="btn-primary" onClick={onReload}>
                Reload app
              </button>
            </>
          ) : (
            <>
              <button className="btn-secondary" onClick={onClose} disabled={running !== null}>
                Close
              </button>
              {hasFixable && (
                <button
                  className="btn-primary"
                  onClick={handleRepair}
                  disabled={running !== null}
                  title="Back up affected files, then apply fixes"
                >
                  {running === "repair" ? "Applying…" : "Apply Repairs"}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────────

function DoctorSummaryChip({
  label,
  count,
  kind,
}: {
  label: string;
  count: number;
  kind: "healthy" | "fixed" | "detected" | "unfixable" | "skipped";
}) {
  return (
    <span className={`doctor-summary-chip doctor-summary-chip-${kind}`}>
      <span className="doctor-summary-count">{count}</span>
      <span>{label}</span>
    </span>
  );
}

function DoctorFindingRow({ finding }: { finding: DoctorFinding }) {
  const icon = statusIcon(finding.status, finding.severity);
  return (
    <li className={`doctor-finding doctor-finding-${finding.status}`}>
      <div className="doctor-finding-icon" aria-hidden>
        {icon}
      </div>
      <div className="doctor-finding-body">
        <div className="doctor-finding-title">{finding.title}</div>
        <div className="doctor-finding-detail">{finding.detail}</div>
        {finding.itemsAffected && finding.itemsAffected.length > 0 && (
          <ul className="doctor-finding-items">
            {finding.itemsAffected.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        )}
        {finding.backupPath && (
          <div className="doctor-finding-backup">
            Backup: <code>{finding.backupPath.split("/").pop()}</code>
          </div>
        )}
      </div>
    </li>
  );
}

function statusIcon(status: DoctorFinding["status"], severity: DoctorFinding["severity"]) {
  const common = {
    width: 14,
    height: 14,
    viewBox: "0 0 16 16",
    fill: "none" as const,
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  if (status === "healthy") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6" />
        <path d="M5.5 8l2 2 3.5-3.5" />
      </svg>
    );
  }
  if (status === "fixed") {
    return (
      <svg {...common}>
        <path d="M13 3l-7 9-3-3" />
      </svg>
    );
  }
  if (status === "skipped") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6" />
        <path d="M5 8h6" />
      </svg>
    );
  }
  if (status === "unfixable") {
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="6" />
        <path d="M5 5l6 6M11 5l-6 6" />
      </svg>
    );
  }
  // detected — warning triangle
  return (
    <svg {...common}>
      <path d="M8 2l6 11H2L8 2z" />
      <path d="M8 6v4M8 12v.5" />
    </svg>
  );
}
