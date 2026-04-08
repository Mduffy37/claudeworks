import React from "react";
import type { Profile } from "../../../electron/types";

interface Props {
  model: string;
  effortLevel: string;
  voiceEnabled: boolean | undefined;
  alias: string;
  isInPath: boolean;
  launchFlags: NonNullable<Profile["launchFlags"]>;
  customFlags: string;
  onChangeModel: (v: string) => void;
  onChangeEffort: (v: string) => void;
  onChangeVoice: (v: boolean) => void;
  onChangeAlias: (v: string) => void;
  onChangeLaunchFlags: (v: NonNullable<Profile["launchFlags"]>) => void;
  onChangeCustomFlags: (v: string) => void;
  onAddToPath: () => void;
}

export function SettingsTab(props: Props) {
  const {
    model, effortLevel, voiceEnabled, alias, isInPath,
    launchFlags, customFlags,
    onChangeModel, onChangeEffort, onChangeVoice, onChangeAlias,
    onChangeLaunchFlags, onChangeCustomFlags, onAddToPath,
  } = props;

  return (
    <div className="pe-settings-tab">
      <div className="pe-settings-section">
        <div className="pe-settings-section-label">Session Behavior</div>
        <div className="modal-fields">
          <div className="field">
            <label>Model</label>
            <select value={model} onChange={(e) => onChangeModel(e.target.value)}>
              <option value="">Default (inherit global)</option>
              <option value="opus">Opus</option>
              <option value="sonnet">Sonnet</option>
              <option value="haiku">Haiku</option>
            </select>
          </div>
          <div className="field-divider" />
          <div className="field">
            <label>Effort Level</label>
            <select value={effortLevel} onChange={(e) => onChangeEffort(e.target.value)}>
              <option value="">Default (inherit global)</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="max">Max</option>
            </select>
          </div>
          <div className="field-divider" />
          <div className="field">
            <label>Voice</label>
            <div className="field-toggle">
              <label className="toggle-switch">
                <input type="checkbox" checked={voiceEnabled ?? true} onChange={(e) => onChangeVoice(e.target.checked)} />
                <span className="toggle-track"><span className="toggle-thumb" /></span>
              </label>
              <span className="field-toggle-label">
                {voiceEnabled === undefined ? "Default" : voiceEnabled ? "Enabled" : "Disabled"}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="pe-settings-section">
        <div className="pe-settings-section-label">Launch Configuration</div>
        <div className="modal-fields">
          <div className="field">
            <label>CLI Alias</label>
            <div className="field-with-button">
              <input type="text" value={alias} onChange={(e) => onChangeAlias(e.target.value.replace(/[^a-z0-9-]/g, ""))} placeholder="e.g. claude-research" />
              {!isInPath && <button className="btn-secondary" onClick={onAddToPath}>Add to PATH</button>}
            </div>
            {alias && (
              <div className="field-hint">
                {isInPath ? <>Run <code>{alias}</code> from any terminal to launch this profile</> : <>Saves to ~/.claude-profiles/bin/ — add to PATH to use</>}
              </div>
            )}
          </div>
          <div className="field-divider" />
          <div className="field">
            <label>Launch Flags</label>
            <div className="flag-toggles">
              <div className="field-toggle">
                <label className="toggle-switch">
                  <input type="checkbox" checked={launchFlags.dangerouslySkipPermissions ?? false} onChange={(e) => onChangeLaunchFlags({ ...launchFlags, dangerouslySkipPermissions: e.target.checked || undefined })} />
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                </label>
                <span className="field-toggle-label"><code>--dangerously-skip-permissions</code></span>
              </div>
              <div className="field-toggle">
                <label className="toggle-switch">
                  <input type="checkbox" checked={launchFlags.verbose ?? false} onChange={(e) => onChangeLaunchFlags({ ...launchFlags, verbose: e.target.checked || undefined })} />
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                </label>
                <span className="field-toggle-label"><code>--verbose</code></span>
              </div>
            </div>
            <input type="text" value={customFlags} onChange={(e) => onChangeCustomFlags(e.target.value)} placeholder="Additional flags, e.g. --max-turns 10" style={{ marginTop: "8px" }} />
            <div className="field-hint">Flags passed to <code>claude</code> when launching this profile</div>
          </div>
        </div>
      </div>
    </div>
  );
}
