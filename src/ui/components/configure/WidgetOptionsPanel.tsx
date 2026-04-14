import React from "react";
import { WIDGET_SCHEMAS, WidgetOptionSchema } from "./widgetSchema";

interface Props {
  widgetId: string;
  options: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
}

export function WidgetOptionsPanel({ widgetId, options, onChange }: Props) {
  const schema = WIDGET_SCHEMAS[widgetId];
  if (!schema || schema.options.length === 0) {
    return <div className="widget-options-panel empty">No options for this widget.</div>;
  }

  return (
    <div className="widget-options-panel">
      <p className="widget-options-description">{schema.description}</p>
      <ul className="widget-options-list">
        {schema.options.map((opt) => (
          <li key={opt.key} className="widget-option-row">
            <label htmlFor={`${widgetId}-${opt.key}`}>{opt.label}</label>
            {renderInput(widgetId, opt, options[opt.key] ?? opt.default, onChange)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function renderInput(
  widgetId: string,
  opt: WidgetOptionSchema,
  value: unknown,
  onChange: (key: string, value: unknown) => void,
) {
  const id = `${widgetId}-${opt.key}`;
  switch (opt.type) {
    case "boolean":
      return (
        <input
          id={id}
          type="checkbox"
          checked={!!value}
          onChange={(e) => onChange(opt.key, e.target.checked)}
        />
      );
    case "number":
      return (
        <input
          id={id}
          type="number"
          value={value as number}
          min={opt.min}
          max={opt.max}
          onChange={(e) => onChange(opt.key, Number(e.target.value))}
        />
      );
    case "select":
      return (
        <select id={id} value={value as string} onChange={(e) => onChange(opt.key, e.target.value)}>
          {opt.choices?.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      );
    case "text":
      return (
        <input id={id} type="text" value={value as string} onChange={(e) => onChange(opt.key, e.target.value)} />
      );
    case "color":
      return (
        <input
          id={id}
          type="color"
          value={value as string}
          onChange={(e) => onChange(opt.key, e.target.value)}
        />
      );
  }
}
