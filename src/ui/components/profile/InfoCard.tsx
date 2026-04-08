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
  isNew: boolean;
  onChangeDescription: (v: string) => void;
}

export function InfoCard({
  description,
  isNew,
  onChangeDescription,
}: InfoCardProps) {
  const [open, setOpen] = useState(isNew || !!description);

  return (
    <div className="pe-info-card">
      <button
        className="pe-info-card-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="profile-info-body"
      >
        <span className="pe-info-card-toggle-chevron">
          <ChevronIcon open={open} />
        </span>
        <span className="pe-info-card-toggle-label">Description</span>
        {!open && description && (
          <span className="pe-info-card-toggle-dir">{description}</span>
        )}
      </button>

      {open && (
        <div className="pe-info-card-body" id="profile-info-body">
          <div className="field">
            <input
              type="text"
              value={description}
              onChange={(e) => onChangeDescription(e.target.value)}
              placeholder="What this profile is for"
            />
          </div>
        </div>
      )}
    </div>
  );
}
