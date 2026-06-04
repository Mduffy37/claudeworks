import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { StatusLineConfig } from "../../../electron/types";
import { ansiToSegments, AnsiSegment } from "./ansiToSegments";

interface Props {
  config: StatusLineConfig;
}

const DEBOUNCE_MS = 200;

export function StatusBarPreview({ config }: Props) {
  const { t } = useTranslation(["settings"]);
  const [segments, setSegments] = useState<AnsiSegment[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const rendered = await window.api.renderStatusLinePreview(config);
        if (cancelled) return;
        setSegments(ansiToSegments(rendered.trimEnd()));
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(String(err));
      }
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config]);

  return (
    <div className="status-bar-preview">
      <div className="status-bar-preview-label">{t("settings:statusLine.preview")}</div>
      {error ? (
        <div className="status-bar-preview-error">{error}</div>
      ) : (
        <div className="status-bar-preview-line">
          {segments.map((seg, idx) => (
            <span key={idx} style={seg.style}>{seg.text}</span>
          ))}
        </div>
      )}
      <div className="status-bar-preview-hint">
        <strong>{t("settings:statusLine.exampleData")}</strong> {t("settings:statusLine.exampleHint")}
        <br />
        <strong>{t("settings:statusLine.realData")}</strong> {t("settings:statusLine.realHint")}
      </div>
    </div>
  );
}
