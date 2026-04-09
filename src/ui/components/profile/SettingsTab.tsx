import React, { useState, useEffect } from "react";
import type { Profile } from "../../../electron/types";

interface HookEntry { event: string; index: number; command: string }

interface Props {
  model: string;
  effortLevel: string;
  voiceEnabled: boolean | undefined;
  alias: string;
  isInPath: boolean;
  launchFlags: NonNullable<Profile["launchFlags"]>;
  customFlags: string;
  useDefaultAuth: boolean;
  env: Record<string, string>;
  profileName: string;
  disabledHooks: Record<string, number[]>;
  isDefault?: boolean;
  onSetAsDefault?: () => void;
  onChangeModel: (v: string) => void;
  onChangeEffort: (v: string) => void;
  onChangeVoice: (v: boolean) => void;
  onChangeAlias: (v: string) => void;
  onChangeLaunchFlags: (v: NonNullable<Profile["launchFlags"]>) => void;
  onChangeCustomFlags: (v: string) => void;
  onChangeUseDefaultAuth: (v: boolean) => void;
  onChangeEnv: (v: Record<string, string>) => void;
  onChangeDisabledHooks: (v: Record<string, number[]>) => void;
  onAddToPath: () => void;
}

export function SettingsTab(props: Props) {
  const {
    model, effortLevel, voiceEnabled, alias, isInPath,
    launchFlags, customFlags, useDefaultAuth, env, profileName, disabledHooks,
    isDefault, onSetAsDefault,
    onChangeModel, onChangeEffort, onChangeVoice, onChangeAlias,
    onChangeLaunchFlags, onChangeCustomFlags, onChangeUseDefaultAuth, onChangeEnv, onChangeDisabledHooks, onAddToPath,
  } = props;

  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [globalHooks, setGlobalHooks] = useState<HookEntry[]>([]);

  useEffect(() => {
    window.api.getGlobalHooks().then((hooks) => {
      const entries: HookEntry[] = [];
      for (const [event, matchers] of Object.entries(hooks)) {
        for (let i = 0; i < (matchers as any[]).length; i++) {
          const matcher = (matchers as any[])[i];
          for (const hook of matcher.hooks ?? []) {
            entries.push({ event, index: i, command: hook.command ?? "" });
          }
        }
      }
      setGlobalHooks(entries);
    });
  }, []);

  const isHookDisabled = (event: string, index: number) =>
    (disabledHooks[event] ?? []).includes(index);

  const toggleHook = (event: string, index: number) => {
    const current = disabledHooks[event] ?? [];
    let next: Record<string, number[]>;
    if (current.includes(index)) {
      const filtered = current.filter((i) => i !== index);
      next = { ...disabledHooks };
      if (filtered.length > 0) next[event] = filtered;
      else delete next[event];
    } else {
      next = { ...disabledHooks, [event]: [...current, index] };
    }
    onChangeDisabledHooks(next);
  };

  const [globalEnv, setGlobalEnv] = useState<Record<string, string>>({});

  useEffect(() => {
    window.api.getGlobalEnv().then(setGlobalEnv);
  }, []);

  // Global env vars not overridden by this profile
  const inheritedEnv = Object.entries(globalEnv).filter(([key]) => !(key in env));
  const envEntries = Object.entries(env);

  const handleAddEnv = () => {
    const key = newKey.trim();
    if (!key) return;
    onChangeEnv({ ...env, [key]: newValue });
    setNewKey("");
    setNewValue("");
  };

  const handleRemoveEnv = (key: string) => {
    const next = { ...env };
    delete next[key];
    onChangeEnv(next);
  };

  const handleUpdateEnvValue = (key: string, value: string) => {
    onChangeEnv({ ...env, [key]: value });
  };

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
        <div className="pe-settings-section-label">Authentication</div>
        <div className="modal-fields">
          <div className="field">
            <div className="field-toggle">
              <label className="toggle-switch">
                <input type="checkbox" checked={useDefaultAuth} onChange={(e) => onChangeUseDefaultAuth(e.target.checked)} />
                <span className="toggle-track"><span className="toggle-thumb" /></span>
              </label>
              <span className="field-toggle-label">Use default authentication</span>
            </div>
            <div className="field-hint">
              {useDefaultAuth
                ? "This profile shares credentials with your default Claude Code installation."
                : "This profile will use its own credentials. You'll need to authenticate separately on first launch."}
            </div>
          </div>
        </div>
      </div>

      <div className="pe-settings-section">
        <div className="pe-settings-section-label">Environment Variables</div>
        <div className="modal-fields">
          {inheritedEnv.length > 0 && (
            <>
              <div className="field-hint" style={{ marginBottom: "2px" }}>Inherited from global settings</div>
              {inheritedEnv.map(([key, value]) => (
                <div className="field" key={`global-${key}`}>
                  <label>{key}</label>
                  <div className="field-with-button">
                    <input type="text" value={value} disabled style={{ opacity: 0.5 }} />
                    <button className="btn-secondary" onClick={() => { onChangeEnv({ ...env, [key]: value }); }} title="Override in this profile">Override</button>
                  </div>
                </div>
              ))}
              <div className="field-divider" />
            </>
          )}
          {envEntries.map(([key, value]) => (
            <div className="field" key={key}>
              <label>{key}{globalEnv[key] !== undefined && <span style={{ color: "var(--accent)", fontSize: "0.692rem", marginLeft: "6px" }}>overriding global</span>}</label>
              <div className="field-with-button">
                <input
                  type="text"
                  value={value}
                  onChange={(e) => handleUpdateEnvValue(key, e.target.value)}
                  placeholder="value"
                />
                <button className="btn-secondary" onClick={() => handleRemoveEnv(key)}>Remove</button>
              </div>
            </div>
          ))}
          {(envEntries.length > 0 || inheritedEnv.length > 0) && <div className="field-divider" />}
          <div className="field">
            <label>Add Variable</label>
            <div className="field-with-button">
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value.replace(/\s/g, ""))}
                placeholder="e.g. CLAUDE_CODE_MAX_OUTPUT_TOKENS"
                onKeyDown={(e) => { if (e.key === "Enter") handleAddEnv(); }}
              />
              <input
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="value"
                onKeyDown={(e) => { if (e.key === "Enter") handleAddEnv(); }}
              />
              <button className="btn-secondary" onClick={handleAddEnv} disabled={!newKey.trim()}>Add</button>
            </div>
          </div>
          {envEntries.length === 0 && (
            <div className="field-hint">Environment variables set when this profile launches.</div>
          )}
        </div>
      </div>

      {globalHooks.length > 0 && (
        <div className="pe-settings-section">
          <div className="pe-settings-section-label">Hooks</div>
          <div className="modal-fields">
            <div className="field-hint" style={{ marginBottom: "4px" }}>
              Global hooks inherited from ~/.claude/settings.json. Toggle off to disable for this profile.
            </div>
            {globalHooks.map((h) => {
              const disabled = isHookDisabled(h.event, h.index);
              return (
                <div key={`${h.event}-${h.index}`} className="field">
                  <div className="field-toggle">
                    <label className="toggle-switch">
                      <input type="checkbox" checked={!disabled} onChange={() => toggleHook(h.event, h.index)} />
                      <span className="toggle-track"><span className="toggle-thumb" /></span>
                    </label>
                    <span className="field-toggle-label">
                      <strong>{h.event}</strong>
                      <span style={{ color: "var(--text-muted)", marginLeft: "8px", fontSize: "0.846rem", fontFamily: '"SF Mono", monospace' }}>{h.command}</span>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div className="pe-settings-section">
        <div className="pe-settings-section-label">Launch Configuration</div>
        <div className="modal-fields">
          <div className="field">
            <label>CLI Alias</label>
            {isDefault ? (
              <>
                <div className="field-with-button">
                  <input type="text" value="claude" disabled style={{ opacity: 0.5 }} />
                  <span className="field-managed-label">managed</span>
                </div>
                <div className="field-hint">
                  This profile intercepts the <code>claude</code> command. The alias is managed automatically.
                </div>
              </>
            ) : (
              <>
                <div className="field-with-button">
                  <input type="text" value={alias} onChange={(e) => onChangeAlias(e.target.value.replace(/[^a-z0-9-]/g, ""))} placeholder="e.g. claude-research" />
                  {!isInPath && <button className="btn-secondary" onClick={onAddToPath}>Add to PATH</button>}
                </div>
                {alias && (
                  <div className="field-hint">
                    {isInPath ? <>Run <code>{alias}</code> from any terminal to launch this profile</> : <>Saves to ~/.claude-profiles/bin/ — add to PATH to use</>}
                  </div>
                )}
              </>
            )}
          </div>
          {!isDefault && onSetAsDefault && (
            <>
              <div className="field-divider" />
              <div className="field">
                <button className="btn-secondary" style={{ width: "100%" }} onClick={onSetAsDefault}>
                  Set as Default Profile
                </button>
                <div className="field-hint">
                  Makes this profile the default. Running <code>claude</code> will launch with this profile's plugins and settings.
                </div>
              </div>
            </>
          )}
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

      {profileName && (
        <div className="pe-settings-section">
          <div className="pe-settings-section-label">Profile Config</div>
          <div className="modal-fields">
            <div className="field">
              <button className="btn-secondary" style={{ width: "100%" }} onClick={async () => { const dir = await window.api.getProfileConfigDir(profileName); window.api.openInFinder(dir); }}>
                Open Config Directory in Finder
              </button>
              <div className="field-hint">View this profile's assembled settings, plugins, and CLAUDE.md</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
