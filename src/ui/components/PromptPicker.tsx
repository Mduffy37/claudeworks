import React, { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Prompt } from "../../electron/types";

// ─── Translate known profile descriptions at display time ───────────────────

function translateDescription(desc: string, t: any): string {
  if (desc === "Your default profile. Running `claude` launches with these plugins and settings.") {
    return t("profile:descriptions.default");
  }
  if (desc === "Dedicated workspace for creating and managing ClaudeWorks profiles.") {
    return t("profile:descriptions.profileCreator");
  }
  return desc;
}

interface Props {
  onSelect: (content: string) => void;
  onClose: () => void;
}

export function PromptPicker({ onSelect, onClose }: Props) {
  const { t } = useTranslation(["common", "profile"]);
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  useEffect(() => {
    window.api.getPrompts().then(setPrompts);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  const allTags = useMemo(() => {
    const tags = new Set<string>();
    for (const p of prompts) for (const t of p.tags) tags.add(t);
    return [...tags].sort();
  }, [prompts]);

  const filtered = useMemo(() => {
    let result = prompts;
    if (activeTag) {
      result = result.filter((p) => p.tags.includes(activeTag));
    }
    const q = search.toLowerCase().trim();
    if (q) {
      result = result.filter((p) =>
        p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q))
      );
    }
    return result;
  }, [prompts, search, activeTag]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="prompt-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="prompt-picker-header">
          <span className="prompt-picker-title">{t("common:buttons.insertPrompt")}</span>
          <button className="modal-close" onClick={onClose} aria-label={t("common:buttons.close")}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="prompt-picker-search">
          <input
            type="text"
            placeholder={t("common:labels.searchPrompts")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        {allTags.length > 0 && (
          <div className="prompt-picker-tags">
            <button
              className={`prompt-picker-tag-btn${activeTag === null ? " active" : ""}`}
              onClick={() => setActiveTag(null)}
            >
              {t("common:labels.all")}
            </button>
            {allTags.map((t) => (
              <button
                key={t}
                className={`prompt-picker-tag-btn${activeTag === t ? " active" : ""}`}
                onClick={() => setActiveTag(activeTag === t ? null : t)}
              >
                {t}
              </button>
            ))}
          </div>
        )}
        <div className="prompt-picker-list">
          {filtered.length === 0 ? (
            <div className="prompt-picker-empty">
              {prompts.length === 0 ? t("common:emptyStates.noPromptsYet") + " " + t("plugin:prompts.reusableSnippets") : t("common:emptyStates.noMatches")}
            </div>
          ) : (
            filtered.map((p) => (
              <div
                key={p.id}
                className="prompt-picker-item"
                onClick={() => { onSelect(p.content); onClose(); }}
              >
                <div className="prompt-picker-item-name">{p.name || t("common:labels.untitled")}</div>
                {p.description && <div className="prompt-picker-item-desc">{translateDescription(p.description, t)}</div>}
                {p.tags.length > 0 && (
                  <div className="prompt-picker-item-tags">
                    {p.tags.map((t) => <span key={t} className="bulk-tag-chip">{t}</span>)}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
