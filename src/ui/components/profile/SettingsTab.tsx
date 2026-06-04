import React, { useState, useEffect, useCallback } from "react";
import { useTranslation, Trans } from "react-i18next";
import type { Profile, ProfileAlias, StatusLineConfig } from "../../../electron/types";

interface HookEntry { event: string; index: number; command: string }

interface Props {
  model: string;
  opusContext: "200k" | "1m" | undefined;
  sonnetContext: "200k" | "1m" | undefined;
  effortLevel: string;
  voiceEnabled: boolean | undefined;
  aliases: ProfileAlias[];
  onChangeAliases: (aliases: ProfileAlias[]) => void;
  disableDefaultAlias: boolean;
  onChangeDisableDefaultAlias: (v: boolean) => void;
  profileName: string;
  pluginCount: number;
  directories: string[];
  isInPath: boolean;
  launchFlags: NonNullable<Profile["launchFlags"]>;
  customFlags: string;
  useDefaultAuth: boolean;
  env: Record<string, string>;
  disabledHooks: Record<string, number[]>;
  statusLineConfig: StatusLineConfig | undefined;
  launchPrompt: string;
  onChangeLaunchPrompt: (v: string) => void;
  isDefault?: boolean;
  onSetAsDefault?: () => void;
  onChangeModel: (v: string) => void;
  onChangeOpusContext: (v: "200k" | "1m" | undefined) => void;
  onChangeSonnetContext: (v: "200k" | "1m" | undefined) => void;
  onChangeEffort: (v: string) => void;
  onChangeVoice: (v: boolean) => void;
  onChangeLaunchFlags: (v: NonNullable<Profile["launchFlags"]>) => void;
  onChangeCustomFlags: (v: string) => void;
  onChangeUseDefaultAuth: (v: boolean) => void;
  onChangeEnv: (v: Record<string, string>) => void;
  onChangeDisabledHooks: (v: Record<string, number[]>) => void;
  onChangeStatusLineConfig: (v: StatusLineConfig | undefined) => void;
  onAddToPath: () => void;
}

export function SettingsTab(props: Props) {
  const {
    model, opusContext, sonnetContext, effortLevel, voiceEnabled,
    aliases, onChangeAliases, disableDefaultAlias, onChangeDisableDefaultAlias,
    profileName, pluginCount, directories,
    isInPath, launchFlags, customFlags, useDefaultAuth, env, disabledHooks,
    statusLineConfig,
    launchPrompt, onChangeLaunchPrompt,
    isDefault, onSetAsDefault,
    onChangeModel, onChangeOpusContext, onChangeSonnetContext, onChangeEffort, onChangeVoice,
    onChangeLaunchFlags, onChangeCustomFlags, onChangeUseDefaultAuth, onChangeEnv, onChangeDisabledHooks,
    onChangeStatusLineConfig,
    onAddToPath,
  } = props;

  const { t } = useTranslation(["profile", "common"]);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [globalHooks, setGlobalHooks] = useState<HookEntry[]>([]);
  const [openAdvanced, setOpenAdvanced] = useState<Record<string, boolean>>({});
  const [knownVars, setKnownVars] = useState<Array<{ name: string; description: string; values: string[] | null }>>([]);
  const [suggestions, setSuggestions] = useState<Array<{ name: string; description: string }>>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [showValueSuggestions, setShowValueSuggestions] = useState(false);

  // Per-alias conflict warnings, keyed by index
  const [aliasConflicts, setAliasConflicts] = useState<Record<number, { conflict: boolean; source: string; detail: string } | null>>({});

  const toggleAdvanced = (id: string) =>
    setOpenAdvanced((prev) => ({ ...prev, [id]: !prev[id] }));

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
    window.api.getKnownEnvVars().then(setKnownVars);
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

  const handleNewKeyChange = (value: string) => {
    const cleaned = value.replace(/\s/g, "");
    setNewKey(cleaned);
    if (cleaned.length > 0) {
      const filtered = knownVars.filter(
        (v) => v.name.toLowerCase().includes(cleaned.toLowerCase()) && !(v.name in env),
      );
      setSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
    } else {
      setShowSuggestions(false);
    }
  };

  const selectSuggestion = (name: string) => {
    setNewKey(name);
    setShowSuggestions(false);
  };

  const knownValuesForKey = knownVars.find((v) => v.name === newKey)?.values ?? null;

  const selectValueSuggestion = (value: string) => {
    setNewValue(value);
    setShowValueSuggestions(false);
  };

  // ── Alias helpers ───────────────────────────────────────────────────────────

  const updateAlias = useCallback((index: number, patch: Partial<ProfileAlias>) => {
    const next = aliases.map((a, i) => i === index ? { ...a, ...patch } : a);
    onChangeAliases(next);
  }, [aliases, onChangeAliases]);

  const removeAlias = useCallback((index: number) => {
    onChangeAliases(aliases.filter((_, i) => i !== index));
    // Clear conflict for removed index
    setAliasConflicts((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  }, [aliases, onChangeAliases]);

  const addAlias = useCallback(() => {
    onChangeAliases([...aliases, { name: "" }]);
  }, [aliases, onChangeAliases]);

  const checkConflict = useCallback(async (index: number, aliasName: string) => {
    if (!aliasName) {
      setAliasConflicts((prev) => ({ ...prev, [index]: null }));
      return;
    }
    // Check for duplicates within this profile first
    const dupeIdx = aliases.findIndex((a, i) => i !== index && a.name === aliasName);
    if (dupeIdx >= 0) {
      setAliasConflicts((prev) => ({ ...prev, [index]: { conflict: true, source: "profile", detail: t("profile:settings.duplicateAlias") } }));
      return;
    }
    try {
      const result = await window.api.checkAliasConflict(aliasName, profileName);
      setAliasConflicts((prev) => ({ ...prev, [index]: result }));
    } catch {
      setAliasConflicts((prev) => ({ ...prev, [index]: null }));
    }
  }, [profileName, aliases]);

  return (
    <div className="pe-settings-tab">
      <div className="pe-settings-section">
        <div className="pe-settings-section-label">{t("profile:settings.sessionBehavior")}</div>
        <div className="modal-fields">
          <div className="field">
            <label>{t("profile:editor.model")}</label>
            <select value={model} onChange={(e) => onChangeModel(e.target.value)}>
              <option value="">{t("profile:settings.defaultInheritGlobal")}</option>
              <option value="opus">Opus</option>
              <option value="sonnet">Sonnet</option>
              <option value="haiku">Haiku</option>
            </select>
          </div>
          {model === "opus" && (
            <>
              <div className="field-divider" />
              <div className="field">
                <label>{t("common:fields.context")}</label>
                <select
                  value={opusContext ?? "1m"}
                  onChange={(e) => onChangeOpusContext(e.target.value as "200k" | "1m")}
                >
                  <option value="1m">{t("profile:settings.opusContextDefault")}</option>
                  <option value="200k">200k</option>
                </select>
                <div className="field-hint">{t("profile:settings.opusContextHint")}</div>
              </div>
            </>
          )}
          {model === "sonnet" && (
            <>
              <div className="field-divider" />
              <div className="field">
                <label>{t("common:fields.context")}</label>
                <select
                  value={sonnetContext ?? "200k"}
                  onChange={(e) => onChangeSonnetContext(e.target.value as "200k" | "1m")}
                >
                  <option value="200k">{t("profile:settings.sonnetContextDefault")}</option>
                  <option value="1m">{t("profile:settings.sonnetContextExtra")}</option>
                </select>
                <div className="field-hint">{t("profile:settings.sonnetContextHint")}</div>
              </div>
            </>
          )}
          <div className="field-divider" />
          <div className="field">
            <label>{t("profile:editor.effortLevel")}</label>
            <select value={effortLevel} onChange={(e) => onChangeEffort(e.target.value)}>
              <option value="">{t("profile:settings.defaultInheritGlobal")}</option>
              <option value="low">{t("profile:settings.effortLow")}</option>
              <option value="medium">{t("profile:settings.effortMedium")}</option>
              <option value="high">{t("profile:settings.effortHigh")}</option>
              <option value="xhigh">{t("profile:settings.effortXhigh")}</option>
              <option value="max">{t("profile:settings.effortMax")}</option>
            </select>
          </div>
          <div className="field-divider" />
          <div className="field">
            <label>{t("common:fields.voice")}</label>
            <div className="field-toggle">
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={voiceEnabled ?? true}
                  onChange={(e) => onChangeVoice(e.target.checked)}
                  aria-label={t("common:fields.voice")}
                />
                <span className="toggle-track"><span className="toggle-thumb" /></span>
              </label>
              <span className="field-toggle-label">
                {voiceEnabled === undefined ? t("profile:settings.defaultVoice") : voiceEnabled ? t("profile:settings.enabledVoice") : t("profile:settings.disabledVoice")}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="pe-settings-section">
        <div className="pe-settings-section-label">{t("profile:settings.statusBar")}</div>
        <div className="modal-fields">
          <div className="field">
            <div className="field-toggle">
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={!!statusLineConfig}
                  onChange={async (e) => {
                    if (e.target.checked) {
                      const global = await window.api.getStatusLineConfig();
                      onChangeStatusLineConfig(global);
                    } else {
                      onChangeStatusLineConfig(undefined);
                    }
                  }}
                  aria-label={t("profile:settings.overrideGlobalStatusBar")}
                />
                <span className="toggle-track"><span className="toggle-thumb" /></span>
              </label>
              <span className="field-toggle-label">{t("profile:settings.overrideGlobalStatusBar")}</span>
            </div>
            <div className="field-hint">
              {statusLineConfig
                ? t("profile:settings.statusBarOverrideHint")
                : t("profile:settings.statusBarDefaultHint")}
            </div>
          </div>
        </div>
      </div>

      <div className="pe-settings-section">
        <div className="pe-settings-section-label">{t("profile:settings.authentication")}</div>
        <div className="modal-fields">
          <div className="field">
            <div className="field-toggle">
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={useDefaultAuth}
                  onChange={(e) => onChangeUseDefaultAuth(e.target.checked)}
                  aria-label={t("profile:settings.useDefaultAuth")}
                />
                <span className="toggle-track"><span className="toggle-thumb" /></span>
              </label>
              <span className="field-toggle-label">{t("profile:settings.useDefaultAuth")}</span>
            </div>
            <div className="field-hint">
              {useDefaultAuth
                ? t("profile:settings.authSharedHint")
                : t("profile:settings.authOwnHint")}
            </div>
          </div>
        </div>
      </div>

      <div className={`pe-settings-section pe-settings-accordion${openAdvanced.env ? " open" : ""}`}>
        <button
          type="button"
          className="pe-settings-accordion-header"
          aria-expanded={!!openAdvanced.env}
          onClick={() => toggleAdvanced("env")}
        >
          <svg className="pe-settings-accordion-chevron" width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path d="M4 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="pe-settings-section-label">{t("profile:settings.envVars")}</span>
          {(envEntries.length > 0 || inheritedEnv.length > 0) && (
            <span className="pe-settings-section-count">{envEntries.length + inheritedEnv.length}</span>
          )}
        </button>
        {openAdvanced.env && (
        <div className="modal-fields">
          {inheritedEnv.length > 0 && (
            <>
              <div className="field-hint" style={{ marginBottom: "2px" }}>{t("profile:settings.inheritedFromGlobal")}</div>
              {inheritedEnv.map(([key, value]) => (
                <div className="env-var-row" key={`global-${key}`}>
                  <input type="text" value={key} disabled aria-label={t("common:fields.name")} title={knownVars.find((v) => v.name === key)?.description} />
                  <input type="text" value={value} disabled aria-label={`${key} value`} />
                  <button className="btn-secondary" onClick={() => { onChangeEnv({ ...env, [key]: value }); }} title={t("profile:settings.overrideInProfile")}>{t("profile:settings.overrideInProfile")}</button>
                </div>
              ))}
              <div className="field-divider" />
            </>
          )}
          {envEntries.map(([key, value]) => (
            <div className="env-var-row" key={key}>
              <input
                type="text"
                value={key}
                disabled
                aria-label={t("common:fields.name")}
                title={knownVars.find((v) => v.name === key)?.description ?? (globalEnv[key] !== undefined ? `${key} (overriding global)` : key)}
                style={globalEnv[key] !== undefined ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
              />
              <input
                type="text"
                value={value}
                onChange={(e) => handleUpdateEnvValue(key, e.target.value)}
                placeholder={t("common:fields.value")}
                aria-label={`${key} value`}
              />
              <button className="btn-secondary" onClick={() => handleRemoveEnv(key)}>{t("common:buttons.remove")}</button>
            </div>
          ))}
          {(envEntries.length > 0 || inheritedEnv.length > 0) && <div className="field-divider" />}
          <div className="env-var-row">
            <div className="env-input-wrapper">
              <input
                type="text"
                value={newKey}
                onChange={(e) => handleNewKeyChange(e.target.value)}
                placeholder="NEW_VAR_NAME"
                aria-label={t("common:fields.name")}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddEnv(); }}
                onFocus={() => { if (newKey.length > 0 && suggestions.length > 0) setShowSuggestions(true); }}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              />
              {showSuggestions && (
                <div className="env-autocomplete-dropdown">
                  {suggestions.map((s) => (
                    <button
                      key={s.name}
                      className="env-autocomplete-item"
                      onMouseDown={(e) => { e.preventDefault(); selectSuggestion(s.name); }}
                    >
                      <span className="env-autocomplete-name">{s.name}</span>
                      <span className="env-autocomplete-desc">{s.description}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="env-input-wrapper">
              <input
                type="text"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder={t("common:fields.value")}
                aria-label={t("common:fields.value")}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddEnv(); }}
                onFocus={() => { if (knownValuesForKey && knownValuesForKey.length > 0) setShowValueSuggestions(true); }}
                onBlur={() => setTimeout(() => setShowValueSuggestions(false), 150)}
              />
              {showValueSuggestions && knownValuesForKey && knownValuesForKey.length > 0 && (
                <div className="env-autocomplete-dropdown">
                  {knownValuesForKey.map((v) => (
                    <button
                      key={v}
                      className="env-autocomplete-item"
                      onMouseDown={(e) => { e.preventDefault(); selectValueSuggestion(v); }}
                    >
                      <span className="env-autocomplete-name">{v}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button className="btn-secondary" onClick={handleAddEnv} disabled={!newKey.trim()}>{t("common:buttons.add")}</button>
          </div>
          {envEntries.length === 0 && inheritedEnv.length === 0 && (
            <div className="field-hint">{t("profile:settings.envVarsHint")}</div>
          )}
        </div>
        )}
      </div>

      {globalHooks.length > 0 && (
        <div className={`pe-settings-section pe-settings-accordion${openAdvanced.hooks ? " open" : ""}`}>
          <button
            type="button"
            className="pe-settings-accordion-header"
            aria-expanded={!!openAdvanced.hooks}
            onClick={() => toggleAdvanced("hooks")}
          >
            <svg className="pe-settings-accordion-chevron" width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M4 2.5l4 3.5-4 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="pe-settings-section-label">{t("profile:settings.hooks")}</span>
            <span className="pe-settings-section-count">{globalHooks.length}</span>
          </button>
          {openAdvanced.hooks && (
          <div className="modal-fields">
            <div className="field-hint" style={{ marginBottom: "4px" }}>
              {t("profile:settings.hooksHint")}
            </div>
            {globalHooks.map((h) => {
              const disabled = isHookDisabled(h.event, h.index);
              return (
                <div key={`${h.event}-${h.index}`} className="field">
                  <div className="field-toggle">
                    <label className="toggle-switch">
                      <input
                        type="checkbox"
                        checked={!disabled}
                        onChange={() => toggleHook(h.event, h.index)}
                        aria-label={`Enable ${h.event} hook: ${h.command}`}
                      />
                      <span className="toggle-track"><span className="toggle-thumb" /></span>
                    </label>
                    <span className="field-toggle-label pe-hook-label">
                      <strong>{h.event}</strong>
                      <code className="pe-hook-command">{h.command}</code>
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
          )}
        </div>
      )}

      <div className="pe-settings-section">
        <div className="pe-settings-section-label">{t("profile:settings.launchConfig")}</div>
        <div className="modal-fields">
          {/* ── Default profile: claude alias toggle ── */}
          {isDefault && (
            <div className="field">
              <div className="field-toggle">
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={disableDefaultAlias}
                    onChange={(e) => onChangeDisableDefaultAlias(e.target.checked)}
                    aria-label="Disable claude override"
                  />
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                </label>
                <span className="field-toggle-label">
                  {t('profile:settings.disableClaudeOverride')}
                </span>
              </div>
              <div className="field-hint">
                {disableDefaultAlias
                  ? t('profile:settings.claudeOverrideDisabledHint')
                  : t('profile:settings.claudeOverrideEnabledHint')}
              </div>
            </div>
          )}

          {/* ── Alias list ── */}
          <div className="field">
            <label>{t("profile:settings.cliAliases")}</label>
            {aliases.length === 0 && !isDefault && (
              <div className="field-hint" style={{ marginBottom: "6px" }}>
                {t("profile:settings.addAliasesHint")}
              </div>
            )}
            {aliases.map((alias, idx) => {
              const isManagedClaudeAlias = isDefault && idx === 0 && alias.name === "claude" && !disableDefaultAlias;
              const conflict = aliasConflicts[idx];
              return (
                <div key={idx} className="alias-row">
                  {!isManagedClaudeAlias && (
                    <button
                      className="alias-remove-btn btn-secondary"
                      onClick={() => removeAlias(idx)}
                      title={t("profile:settings.removeAlias")}
                      aria-label={`${t("profile:settings.removeAlias")} ${alias.name || "(unnamed)"}`}
                    >
                      {t("profile:settings.removeAlias")}
                    </button>
                  )}
                  <div className="alias-row-fields">
                    <div className="field">
                      <label>{t("common:fields.name")}</label>
                      <input
                        type="text"
                        value={alias.name}
                        onChange={(e) => updateAlias(idx, { name: e.target.value.replace(/[^a-z0-9-]/g, "") })}
                        onBlur={() => checkConflict(idx, alias.name)}
                        placeholder={t("profile:settings.aliasNamePlaceholder")}
                        disabled={isManagedClaudeAlias}
                        style={isManagedClaudeAlias ? { opacity: 0.5 } : undefined}
                        aria-label={`Alias ${idx + 1} name`}
                      />
                      {isManagedClaudeAlias && (
                        <span className="field-managed-label" style={{ marginTop: "4px", display: "inline-block" }}>{t("common:labels.managed")}</span>
                      )}
                      {conflict && conflict.conflict && (
                        <div className="field-warning">{conflict.detail}</div>
                      )}
                    </div>
                    <div className="field">
                      <label>{t("common:fields.directory")}</label>
                      <select
                        value={alias.directory ?? ""}
                        onChange={(e) => updateAlias(idx, { directory: e.target.value || undefined })}
                        aria-label={`Alias ${idx + 1} directory`}
                      >
                        <option value="">{t("profile:settings.defaultProfileDir")}</option>
                        {directories.map((d) => (
                          <option key={d} value={d}>{d.split("/").pop() || d}</option>
                        ))}
                      </select>
                    </div>
                    <div className="field">
                      <label>{t("profile:settings.launchAction")}</label>
                      <select
                        value={alias.launchAction ?? ""}
                        onChange={(e) => {
                          const v = e.target.value as "" | "workflow" | "prompt";
                          updateAlias(idx, {
                            launchAction: v || undefined,
                            launchPrompt: v === "prompt" ? (alias.launchPrompt ?? "") : undefined,
                          });
                        }}
                        aria-label={`Alias ${idx + 1} launch action`}
                      >
                        <option value="">{t("profile:settings.launchActionNone")}</option>
                        <option value="workflow">{t("profile:settings.launchActionWorkflow")}</option>
                        <option value="prompt">{t("profile:settings.launchActionPrompt")}</option>
                      </select>
                    </div>
                  </div>
                  {alias.launchAction === "prompt" && (
                    <textarea
                      className="alias-prompt-textarea"
                      value={alias.launchPrompt ?? ""}
                      onChange={(e) => updateAlias(idx, { launchPrompt: e.target.value })}
                      placeholder={t("profile:settings.aliasPromptPlaceholder")}
                      aria-label={`Alias ${idx + 1} custom prompt`}
                    />
                  )}
                </div>
              );
            })}
            <button className="btn-secondary" style={{ marginTop: "4px" }} onClick={addAlias}>
              + {t("profile:editor.aliases")}
            </button>
            {!isInPath && aliases.length > 0 && (
              <div className="field-hint" style={{ marginTop: "6px" }}>
                {t('profile:settings.aliasesSavedHint')}
              </div>
            )}
            {isInPath && aliases.length > 0 && (
              <div className="field-hint" style={{ marginTop: "6px" }}>
                {t("profile:settings.runAliasHint")}
              </div>
            )}
          </div>

          {onSetAsDefault && (
            <>
              <div className="field-divider" />
              <div className="field">
                <button className="btn-secondary" style={{ width: "100%" }} onClick={onSetAsDefault}>
                  {isDefault ? t("profile:settings.removeAsDefault") : t("profile:settings.setAsDefault")}
                </button>
                <div className="field-hint">
                  {isDefault
                    ? t('profile:settings.removeAsDefaultHint')
                    : t('profile:settings.setAsDefaultHint')}
                </div>
              </div>
            </>
          )}
          <div className="field-divider" />
          <div className="field">
            <label htmlFor="launch-prompt-input">{t("profile:editor.launchPrompt")}</label>
            <input
              id="launch-prompt-input"
              type="text"
              className="text-input"
              value={launchPrompt}
              onChange={(e) => onChangeLaunchPrompt(e.target.value)}
              placeholder={t("profile:settings.launchPromptPlaceholder")}
            />
            <div className="field-hint">
              {t('profile:settings.launchPromptHint')}
            </div>
          </div>

          <div className="field-divider" />
          <div className="field">
            <label>{t("profile:editor.launchFlags")}</label>
            <div className="flag-toggles">
              <div className="field-toggle">
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={launchFlags.dangerouslySkipPermissions ?? false}
                    onChange={(e) => onChangeLaunchFlags({ ...launchFlags, dangerouslySkipPermissions: e.target.checked || undefined })}
                    aria-label="Enable --dangerously-skip-permissions launch flag"
                  />
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                </label>
                <span className="field-toggle-label"><code>--dangerously-skip-permissions</code></span>
              </div>
              <div className="field-toggle">
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={launchFlags.verbose ?? false}
                    onChange={(e) => onChangeLaunchFlags({ ...launchFlags, verbose: e.target.checked || undefined })}
                    aria-label="Enable --verbose launch flag"
                  />
                  <span className="toggle-track"><span className="toggle-thumb" /></span>
                </label>
                <span className="field-toggle-label"><code>--verbose</code></span>
              </div>
            </div>
            <input type="text" value={customFlags} onChange={(e) => onChangeCustomFlags(e.target.value)} placeholder={t("profile:settings.customFlagsPlaceholder")} style={{ marginTop: "8px" }} />
            <div className="field-hint">t('profile:settings.customFlagsHint')</div>
          </div>
        </div>
      </div>

      {profileName && (
        <div className="pe-settings-section">
          <div className="pe-settings-section-label">{t("profile:settings.profileConfig")}</div>
          <div className="modal-fields">
            <div className="field">
              <button className="btn-secondary" style={{ width: "100%" }} onClick={async () => { const dir = await window.api.getProfileConfigDir(profileName); window.api.openInFinder(dir); }}>
                {t("profile:settings.openConfigDir")}
              </button>
              <div className="field-hint">{t("profile:settings.configDirHint")}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
