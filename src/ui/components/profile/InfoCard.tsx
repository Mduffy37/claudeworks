import React, { useState } from "react";

// ─── Icons ──────────────────────────────────────────────────────────────────

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      style={{
        transform: open ? "rotate(180deg)" : "rotate(0deg)",
        transition: "transform 180ms ease",
      }}
    >
      <path
        d="M2.5 4L5 6.5L7.5 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── InfoCard ───────────────────────────────────────────────────────────────

interface InfoCardProps {
  description: string;
  directories: string[];
  isNew: boolean;
  onChangeDescription: (v: string) => void;
  onChangeDirectories: (dirs: string[]) => void;
}

export function InfoCard({
  description,
  directories,
  isNew,
  onChangeDescription,
  onChangeDirectories,
}: InfoCardProps) {
  const [open, setOpen] = useState(isNew);

  const addDirectory = async () => {
    const dir = await window.api.selectDirectory();
    if (dir && !directories.includes(dir)) {
      onChangeDirectories([...directories, dir]);
    }
  };

  return (
    <div className="pe-info-card">
      <button
        className="pe-info-card-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="profile-info-body"
      >
        <span className="pe-info-card-toggle-label">Profile Info</span>
        {!open && directories.length > 0 && (
          <span className="pe-info-card-toggle-dir">{directories[0]}{directories.length > 1 ? ` +${directories.length - 1}` : ""}</span>
        )}
        <span className="pe-info-card-toggle-chevron">
          <ChevronIcon open={open} />
        </span>
      </button>

      {open && (
        <div className="pe-info-card-body" id="profile-info-body">
          <div className="field">
            <label>Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => onChangeDescription(e.target.value)}
              placeholder="What this profile is for"
            />
          </div>

          <div className="field-divider" />

          <div className="field">
            <label>Directories</label>
            <div className="dir-list">
              {directories.map((dir, i) => (
                <div key={dir} className="dir-list-item">
                  <span className="dir-list-path">{dir}</span>
                  <button
                    className="dir-list-remove"
                    onClick={() => onChangeDirectories(directories.filter((_, j) => j !== i))}
                    title="Remove"
                  >
                    &times;
                  </button>
                </div>
              ))}
              <div className="field-with-button">
                <button className="btn-secondary" onClick={addDirectory} style={{ width: "100%" }}>
                  + Add Directory
                </button>
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
