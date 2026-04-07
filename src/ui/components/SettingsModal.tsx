import React, { useEffect, useRef } from "react";

interface Props {
  model: string;
  effortLevel: string;
  voiceEnabled: boolean | undefined;
  customClaudeMd: string;
  alias: string;
  isInPath: boolean;
  onChangeModel: (v: string) => void;
  onChangeEffort: (v: string) => void;
  onChangeVoice: (v: boolean) => void;
  onChangeClaudeMd: (v: string) => void;
  onChangeAlias: (v: string) => void;
  onAddToPath: () => void;
  onClose: () => void;
}

export function SettingsModal({
  model,
  effortLevel,
  voiceEnabled,
  customClaudeMd,
  alias,
  isInPath,
  onChangeModel,
  onChangeEffort,
  onChangeVoice,
  onChangeClaudeMd,
  onChangeAlias,
  onAddToPath,
  onClose,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  // Trap focus inside the dialog
  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="modal-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Session Settings"
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="modal-header">
          <span className="modal-title">Session Settings</span>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close settings"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path
                d="M2 2l8 8M10 2l-8 8"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          <p className="modal-description">
            These settings override global Claude defaults for sessions launched with this profile.
          </p>

          <div className="modal-fields">
            {/* Model */}
            <div className="field">
              <label>Model</label>
              <select
                value={model}
                onChange={(e) => onChangeModel(e.target.value)}
              >
                <option value="">Default (inherit global)</option>
                <option value="opus">Opus</option>
                <option value="sonnet">Sonnet</option>
                <option value="haiku">Haiku</option>
              </select>
            </div>

            <div className="field-divider" />

            {/* Effort Level */}
            <div className="field">
              <label>Effort Level</label>
              <select
                value={effortLevel}
                onChange={(e) => onChangeEffort(e.target.value)}
              >
                <option value="">Default (inherit global)</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="max">Max</option>
              </select>
            </div>

            <div className="field-divider" />

            {/* Voice */}
            <div className="field">
              <label>Voice</label>
              <div className="field-toggle">
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={voiceEnabled ?? true}
                    onChange={(e) => onChangeVoice(e.target.checked)}
                  />
                  <span className="toggle-track">
                    <span className="toggle-thumb" />
                  </span>
                </label>
                <span className="field-toggle-label">
                  {voiceEnabled === undefined
                    ? "Default"
                    : voiceEnabled
                    ? "Enabled"
                    : "Disabled"}
                </span>
              </div>
            </div>

            <div className="field-divider" />

            {/* CLI Alias */}
            <div className="field">
              <label>CLI Alias</label>
              <div className="field-with-button">
                <input
                  type="text"
                  value={alias}
                  onChange={(e) => onChangeAlias(e.target.value.replace(/[^a-z0-9-]/g, ""))}
                  placeholder="e.g. claude-research"
                />
                {!isInPath && (
                  <button className="btn-secondary" onClick={onAddToPath}>
                    Add to PATH
                  </button>
                )}
              </div>
              {alias && (
                <div className="field-hint">
                  {isInPath
                    ? <>Run <code>{alias}</code> from any terminal to launch this profile</>
                    : <>Saves to ~/.claude-profiles/bin/ — add to PATH to use</>
                  }
                </div>
              )}
            </div>
          </div>

          {/* CLAUDE.md — full-width section */}
          <div className="modal-claudemd">
            <div className="modal-claudemd-header">
              <span className="modal-claudemd-label">Profile CLAUDE.md</span>
              <span className="modal-claudemd-hint">
                Appended to your global CLAUDE.md for sessions using this profile
              </span>
            </div>
            <textarea
              className="claude-md-editor"
              value={customClaudeMd}
              onChange={(e) => onChangeClaudeMd(e.target.value)}
              placeholder="Additional instructions for this profile..."
              rows={6}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
