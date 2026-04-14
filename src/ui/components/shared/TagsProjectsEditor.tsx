import React, { useEffect, useRef, useState } from "react";

interface Props {
  tags: string[];
  projects: string[];
  tagSuggestions: string[];
  importedProjects: string[];
  onChangeTags: (tags: string[]) => void;
  onChangeProjects: (projects: string[]) => void;
  onOpenProjectsConfig: () => void;
  /** Incremented by parent to request focus on the tag input (e.g. from sidebar empty-state click). */
  focusTagsSignal?: number;
  /** Incremented by parent to request focus on the project picker. */
  focusProjectsSignal?: number;
}

function shortPath(dir: string): string {
  const parts = dir.split("/").filter(Boolean);
  if (parts.length <= 1) return dir;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

export function TagsProjectsEditor({
  tags,
  projects,
  tagSuggestions,
  importedProjects,
  onChangeTags,
  onChangeProjects,
  onOpenProjectsConfig,
  focusTagsSignal,
  focusProjectsSignal,
}: Props) {
  const [tagInput, setTagInput] = useState("");
  const [addingTag, setAddingTag] = useState(false);
  const [addingProject, setAddingProject] = useState(false);
  const tagInputRef = useRef<HTMLInputElement | null>(null);
  const projectSelectRef = useRef<HTMLSelectElement | null>(null);
  const lastConsumedTagSignalRef = useRef(focusTagsSignal);
  const lastConsumedProjectSignalRef = useRef(focusProjectsSignal);

  useEffect(() => {
    if (focusTagsSignal === undefined) return;
    // Only react when the signal actually increments from a parent-initiated
    // request. Without this guard the effect would fire on every mount
    // (initial signal value = 0), opening the tag input whenever a profile
    // is selected.
    if (focusTagsSignal === lastConsumedTagSignalRef.current) return;
    lastConsumedTagSignalRef.current = focusTagsSignal;
    setAddingTag(true);
    requestAnimationFrame(() => tagInputRef.current?.focus());
  }, [focusTagsSignal]);

  useEffect(() => {
    if (focusProjectsSignal === undefined) return;
    if (focusProjectsSignal === lastConsumedProjectSignalRef.current) return;
    lastConsumedProjectSignalRef.current = focusProjectsSignal;
    if (importedProjects.length === 0) {
      onOpenProjectsConfig();
      return;
    }
    setAddingProject(true);
    requestAnimationFrame(() => projectSelectRef.current?.focus());
  }, [focusProjectsSignal, importedProjects.length, onOpenProjectsConfig]);

  useEffect(() => {
    if (addingTag) {
      requestAnimationFrame(() => tagInputRef.current?.focus());
    }
  }, [addingTag]);

  useEffect(() => {
    if (addingProject && importedProjects.length > 0) {
      requestAnimationFrame(() => projectSelectRef.current?.focus());
    }
  }, [addingProject, importedProjects.length]);

  const commitTag = () => {
    const next = tagInput.trim();
    if (!next) {
      setAddingTag(false);
      return;
    }
    if (!tags.includes(next)) {
      onChangeTags([...tags, next]);
    }
    setTagInput("");
    setAddingTag(false);
  };

  const removeTag = (t: string) => onChangeTags(tags.filter((x) => x !== t));
  const removeProject = (p: string) => onChangeProjects(projects.filter((x) => x !== p));

  const availableProjects = importedProjects.filter((p) => !projects.includes(p));

  const handleAddProjectClick = () => {
    if (importedProjects.length === 0) {
      onOpenProjectsConfig();
      return;
    }
    setAddingProject(true);
  };

  return (
    <div className="pe-tp-editor">
      <div className="pe-tp-row">
        <span className="pe-tp-label">Tags</span>
        <div className="pe-tp-chips">
          {tags.map((t) => (
            <span key={t} className="pe-tp-chip">
              {t}
              <button
                type="button"
                className="pe-tp-chip-remove"
                onClick={() => removeTag(t)}
                aria-label={`Remove tag ${t}`}
              >
                ×
              </button>
            </span>
          ))}
          {addingTag ? (
            <input
              ref={tagInputRef}
              className="pe-tp-input"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onBlur={commitTag}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  commitTag();
                } else if (e.key === "Escape") {
                  setTagInput("");
                  setAddingTag(false);
                }
              }}
              list="pe-tp-tag-suggestions"
              placeholder="Tag name"
            />
          ) : (
            <button
              type="button"
              className="pe-tp-add-btn"
              onClick={() => setAddingTag(true)}
            >
              + Tag
            </button>
          )}
          <datalist id="pe-tp-tag-suggestions">
            {tagSuggestions
              .filter((t) => !tags.includes(t))
              .map((t) => (
                <option key={t} value={t} />
              ))}
          </datalist>
        </div>
      </div>

      <div className="pe-tp-row">
        <span className="pe-tp-label">Projects</span>
        <div className="pe-tp-chips">
          {projects.map((p) => (
            <span key={p} className="pe-tp-chip pe-tp-chip-project" title={p}>
              {shortPath(p)}
              <button
                type="button"
                className="pe-tp-chip-remove"
                onClick={() => removeProject(p)}
                aria-label={`Remove project ${p}`}
              >
                ×
              </button>
            </span>
          ))}
          {addingProject && availableProjects.length > 0 ? (
            <select
              ref={projectSelectRef}
              className="pe-tp-input"
              value=""
              onChange={(e) => {
                if (e.target.value) {
                  onChangeProjects([...projects, e.target.value]);
                }
                setAddingProject(false);
              }}
              onBlur={() => setAddingProject(false)}
            >
              <option value="">Pick project…</option>
              {availableProjects.map((p) => (
                <option key={p} value={p}>{shortPath(p)}</option>
              ))}
            </select>
          ) : (
            <button
              type="button"
              className="pe-tp-add-btn"
              onClick={handleAddProjectClick}
              title={importedProjects.length === 0 ? "Import projects first" : undefined}
            >
              + Project
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
