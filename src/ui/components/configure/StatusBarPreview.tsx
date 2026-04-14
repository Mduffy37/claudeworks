import React, { useEffect, useState } from "react";
import type { StatusLineConfig } from "../../../electron/types";
import { ansiToSegments, AnsiSegment } from "./ansiToSegments";

interface Props {
  config: StatusLineConfig;
}

const DEBOUNCE_MS = 200;

export function StatusBarPreview({ config }: Props) {
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
      <div className="status-bar-preview-label">Preview</div>
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
        <strong>Example data:</strong> model, context%, cost, uptime, lines, burn, and ctx-to-full use a mock session (Opus, 25% context, 30m, $0.50).
        <br />
        <strong>Real data:</strong> time, git, cwd, 5h/7d usage, active profile, and plugin count are queried live.
      </div>
    </div>
  );
}
