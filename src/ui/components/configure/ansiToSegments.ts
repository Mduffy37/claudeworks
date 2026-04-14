import type { CSSProperties } from "react";

/**
 * Minimal ANSI-to-segments parser for the status line preview.
 *
 * Handles the specific escape sequences produced by statusline-render.py:
 * 24-bit foreground colors via `\x1b[1;38;2;R;G;Bm` and resets via `\x1b[0m`.
 * Returns an array of `{text, style}` tuples. Callers render them with JSX
 * spans, which is XSS-safe: React escapes text content and inline style
 * objects are JS-typed, not string-parsed.
 */
export interface AnsiSegment {
  text: string;
  style: CSSProperties;
}

export function ansiToSegments(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = [];
  let currentStyle: CSSProperties = {};
  let i = 0;

  const flush = (text: string) => {
    if (text.length > 0) {
      segments.push({ text, style: { ...currentStyle } });
    }
  };

  while (i < input.length) {
    const esc = input.indexOf("\x1b[", i);
    if (esc === -1) {
      flush(input.slice(i));
      break;
    }
    if (esc > i) flush(input.slice(i, esc));

    const end = input.indexOf("m", esc);
    if (end === -1) {
      flush(input.slice(esc));
      break;
    }

    const seq = input.slice(esc + 2, end);
    const codes = seq.split(";").map((x) => Number(x));

    if (codes.length === 1 && codes[0] === 0) {
      currentStyle = {};
    } else {
      const fg38Idx = codes.indexOf(38);
      if (fg38Idx >= 0 && codes[fg38Idx + 1] === 2) {
        const r = codes[fg38Idx + 2] ?? 0;
        const g = codes[fg38Idx + 3] ?? 0;
        const b = codes[fg38Idx + 4] ?? 0;
        currentStyle = {
          ...currentStyle,
          color: `rgb(${r},${g},${b})`,
        };
      }
      if (codes.includes(1)) {
        currentStyle = { ...currentStyle, fontWeight: 700 };
      }
    }

    i = end + 1;
  }

  return segments;
}
