import React, { useState, useRef, useEffect } from "react";
import type { Profile, LaunchOptions } from "../../../electron/types";
import { LaunchOptionsPopover } from "../shared/LaunchOptionsPopover";

// ─── Icons ──────────────────────────────────────────────────────────────────

export function LaunchIcon({ spinning }: { spinning: boolean }) {
  if (spinning) {
    return (
      <svg
        width="13"
        height="13"
        viewBox="0 0 14 14"
        fill="none"
        style={{ animation: "spin 1s linear infinite" }}
      >
        <circle cx="7" cy="7" r="5.5" stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" />
        <path d="M7 1.5A5.5 5.5 0 0 1 12.5 7" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
      <path d="M3 7h8M8 4l3 3-3 3" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

export function shortPath(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  return parts.length <= 1 ? dir : `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

// ─── ProfileTopBar ──────────────────────────────────────────────────────────

interface ProfileTopBarProps {
  profile: Profile | null;
  isNew: boolean;
  name: string;
  dirty: boolean;
  saving: boolean;
  saveStatus: "idle" | "saved";
  selectedPlugins: string[];
  directories: string[];
  launchDir: string;
  launching: boolean;
  importedProjectsCount: number;
  onOpenProjectsConfig?: () => void;
  onChangeName: (v: string) => void;
  markDirty: () => void;
  onSetLaunchDir: (dir: string) => void;
  onSetConfirmDelete: (v: boolean) => void;
  onDuplicate?: (name: string) => void;
  onSetOverviewOpen: (v: boolean) => void;
  onSave: () => void;
  onLaunch: () => void;
  onLaunchWithOptions?: (options: LaunchOptions) => void;
}

export function ProfileTopBar({
  profile,
  isNew,
  name,
  dirty,
  saving,
  saveStatus,
  selectedPlugins,
  directories,
  launchDir,
  launching,
  importedProjectsCount,
  onOpenProjectsConfig,
  onChangeName,
  markDirty,
  onSetLaunchDir,
  onSetConfirmDelete,
  onDuplicate,
  onSetOverviewOpen,
  onSave,
  onLaunch,
  onLaunchWithOptions,
}: ProfileTopBarProps) {
  const [showOverflow, setShowOverflow] = useState(false);
  const [showLaunchOptions, setShowLaunchOptions] = useState(false);
  const overflowTriggerRef = useRef<HTMLButtonElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showOverflow) return;
    const first = overflowMenuRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]");
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setShowOverflow(false);
        overflowTriggerRef.current?.focus();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const items = Array.from(overflowMenuRef.current?.querySelectorAll<HTMLButtonElement>("[role=menuitem]") ?? []);
        if (items.length === 0) return;
        const current = items.indexOf(document.activeElement as HTMLButtonElement);
        const nextIdx = e.key === "ArrowDown"
          ? (current + 1) % items.length
          : (current - 1 + items.length) % items.length;
        items[nextIdx]?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showOverflow]);
  const enabledCount = selectedPlugins.length;
  const subtitle = isNew
    ? "Configure plugins and skills for this profile"
    : enabledCount === 0
    ? "No plugins enabled"
    : `${enabledCount} plugin${enabledCount !== 1 ? "s" : ""} enabled`;

  return (
    <div className="pe-topbar">
      {/* Left: Name + subtitle, vertically centered */}
      <div className="pe-topbar-identity">
        <div className="pe-topbar-name-row">
          <input
            className="pe-topbar-name-input"
            value={name}
            onChange={(e) => { onChangeName(e.target.value); markDirty(); }}
            placeholder={isNew ? "Profile name..." : ""}
            autoFocus={isNew}
          />
          {dirty && !isNew && (
            <span
              className="pe-topbar-unsaved-dot"
              role="status"
              aria-label="Unsaved changes"
              title="Unsaved changes"
            />
          )}
        </div>
        <span className="pe-topbar-subtitle">
          {dirty && !isNew ? "Unsaved changes \u00B7 " : ""}{subtitle}
        </span>
      </div>

      {/* Right: stacked controls */}
      <div className="pe-topbar-right">
        {/* Row 1: dir select + Launch */}
        {!isNew && profile && (
          <div className="pe-topbar-controls-row">
            <select
              className="pe-launch-dir-select"
              aria-label="Launch directory"
              value={launchDir}
              onChange={(e) => onSetLaunchDir(e.target.value)}
              onMouseDown={(e) => {
                if (importedProjectsCount === 0) {
                  e.preventDefault();
                  onOpenProjectsConfig?.();
                }
              }}
            >
              <option value="">Choose directory…</option>
              {directories.map((dir) => (
                <option key={dir} value={dir}>{shortPath(dir)}</option>
              ))}
            </select>
            <div className="btn-launch-group">
              <button
                className={`btn-launch${launching ? " launching" : ""}${dirty ? " dimmed" : ""}`}
                disabled={launching}
                onClick={onLaunch}
                aria-label={dirty ? "Launch profile in iTerm2 (unsaved changes will not apply until saved)" : "Launch profile in iTerm2"}
                title={dirty ? "You have unsaved changes — save first to apply them to the launched session" : undefined}
              >
                <span className="btn-launch-icon">
                  <LaunchIcon spinning={launching} />
                </span>
                {launching ? "Launching\u2026" : "Launch"}
              </button>
              <button
                className="btn-launch-settings"
                onClick={() => setShowLaunchOptions(true)}
                aria-label="Launch settings"
                title="Launch settings"
              >
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                  <path d="M2 3.5l3 3 3-3" stroke="white" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {showLaunchOptions && onLaunchWithOptions && (
                <LaunchOptionsPopover
                  defaultDangerous={profile?.launchFlags?.dangerouslySkipPermissions}
                  showTmux={false}
                  onLaunch={(opts) => { setShowLaunchOptions(false); onLaunchWithOptions(opts); }}
                  onClose={() => setShowLaunchOptions(false)}
                />
              )}
            </div>
          </div>
        )}

        {/* Row 2: ... + Settings + Save */}
        <div className="pe-topbar-controls-row pe-topbar-controls-row-end">
          {!isNew && profile && (
            <div className="pe-topbar-secondary">
              <button
                ref={overflowTriggerRef}
                id="pe-overflow-trigger"
                className="pe-overflow-btn"
                type="button"
                onClick={() => setShowOverflow(!showOverflow)}
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={showOverflow}
                aria-controls="pe-overflow-menu"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <circle cx="3" cy="8" r="1.3" fill="currentColor" />
                  <circle cx="8" cy="8" r="1.3" fill="currentColor" />
                  <circle cx="13" cy="8" r="1.3" fill="currentColor" />
                </svg>
              </button>
              {showOverflow && (
                <>
                  <div className="pe-overflow-backdrop" onClick={() => setShowOverflow(false)} />
                  <div
                    ref={overflowMenuRef}
                    id="pe-overflow-menu"
                    className="pe-overflow-menu"
                    role="menu"
                    aria-labelledby="pe-overflow-trigger"
                  >
                    {onDuplicate && (
                      <button role="menuitem" type="button" onClick={() => { setShowOverflow(false); onDuplicate(profile.name); }}>
                        Duplicate
                      </button>
                    )}
                    <button role="menuitem" type="button" onClick={() => { setShowOverflow(false); onSetOverviewOpen(true); }}>
                      Overview
                    </button>
                    <div className="pe-overflow-divider" role="separator" />
                    <button role="menuitem" type="button" className="pe-overflow-danger" onClick={() => { setShowOverflow(false); onSetConfirmDelete(true); }}>
                      Delete Profile
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <button
            className={`btn-primary${dirty && !saving ? " btn-primary-dirty" : ""}`}
            disabled={!name.trim() || !dirty || saving}
            onClick={onSave}
          >
            {saving ? "Saving\u2026" : saveStatus === "saved" ? "\u2713 Saved" : isNew ? "Create Profile" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
