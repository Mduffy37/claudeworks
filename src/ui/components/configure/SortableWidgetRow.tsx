import React, { useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { StatusLineWidget } from "../../../electron/types";
import { WidgetOptionsPanel } from "./WidgetOptionsPanel";
import { WIDGET_SCHEMAS } from "./widgetSchema";

interface Props {
  sectionId: string;
  widget: StatusLineWidget;
  label: string;
  onToggle: (enabled: boolean) => void;
  onOptionChange: (key: string, value: unknown) => void;
}

export function SortableWidgetRow({ sectionId, widget, label, onToggle, onOptionChange }: Props) {
  const [expanded, setExpanded] = useState(false);
  const id = `${sectionId}:${widget.id}`;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const hasOptions = (WIDGET_SCHEMAS[widget.id]?.options.length ?? 0) > 0;

  return (
    <li ref={setNodeRef} style={style} className="status-bar-widget-row-wrapper">
      <div className="status-bar-widget-row">
        <span className="status-bar-drag-handle" {...attributes} {...listeners} aria-label="Drag to reorder">
          ⋮⋮
        </span>
        <label>
          <input
            type="checkbox"
            checked={widget.enabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <span className="status-bar-widget-name">{label}</span>
        </label>
        {hasOptions && (
          <button
            type="button"
            className="status-bar-widget-expand"
            onClick={() => setExpanded(!expanded)}
            aria-label={expanded ? "Collapse options" : "Expand options"}
          >
            {expanded ? "▼" : "▶"}
          </button>
        )}
      </div>
      {expanded && hasOptions && (
        <WidgetOptionsPanel
          widgetId={widget.id}
          options={widget.options}
          onChange={onOptionChange}
        />
      )}
    </li>
  );
}
