import React, { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";

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
  const { t } = useTranslation(["profile", "common"]);
  const [open, setOpen] = useState(isNew || !!description);

  // Translate description for display
  const displayDescription = useMemo(() => translateDescription(description, t), [description, t]);

  return (
    <div className="pe-info-card">
      <button
        className="pe-info-card-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls="profile-info-body"
        aria-label={t("profile:editor.description")}
      >
        <span className="pe-info-card-toggle-chevron" aria-hidden="true">
          <ChevronIcon open={open} />
        </span>
        <span className="pe-info-card-toggle-label" aria-hidden="true">{t("profile:editor.description")}</span>
        {!open && description && (
          <>
            <span className="pe-info-card-toggle-preview" aria-hidden="true">{displayDescription}</span>
            <span className="pe-info-card-toggle-more" aria-hidden="true">{t("common:buttons.showMore")}</span>
          </>
        )}
      </button>

      {open && (
        <div className="pe-info-card-body" id="profile-info-body">
          <div className="field">
            <input
              type="text"
              value={description}
              onChange={(e) => onChangeDescription(e.target.value)}
              placeholder={t("profile:editor.descriptionPlaceholder")}
            />
          </div>
        </div>
      )}
    </div>
  );
}
