import React, { useState, useEffect, useMemo } from "react";
import type { Prompt } from "../../electron/types";

interface Props {
  onSelect: (content: string) => void;
  onClose: () => void;
}

export function PromptPicker({ onSelect, onClose }: Props) {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [search, setSearch] = useState("");

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

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return prompts;
    return prompts.filter((p) =>
      p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q) || p.tags.some((t) => t.toLowerCase().includes(q))
    );
  }, [prompts, search]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="prompt-picker-modal" onClick={(e) => e.stopPropagation()}>
        <div className="prompt-picker-header">
          <span className="prompt-picker-title">Insert Prompt</span>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="prompt-picker-search">
          <input
            type="text"
            placeholder="Search prompts..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>
        <div className="prompt-picker-list">
          {filtered.length === 0 ? (
            <div className="prompt-picker-empty">
              {prompts.length === 0 ? "No prompts yet. Create one in Configure Claude > Prompts." : "No matches."}
            </div>
          ) : (
            filtered.map((p) => (
              <div
                key={p.id}
                className="prompt-picker-item"
                onClick={() => { onSelect(p.content); onClose(); }}
              >
                <div className="prompt-picker-item-name">{p.name || "Untitled"}</div>
                {p.description && <div className="prompt-picker-item-desc">{p.description}</div>}
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
