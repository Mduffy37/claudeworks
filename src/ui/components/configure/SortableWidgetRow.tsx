import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { StatusLineWidget } from "../../../electron/types";

interface Props {
  sectionId: string;
  widget: StatusLineWidget;
  label: string;
  onToggle: (enabled: boolean) => void;
}

export function SortableWidgetRow({ sectionId, widget, label, onToggle }: Props) {
  const id = `${sectionId}:${widget.id}`;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <li ref={setNodeRef} style={style} className="status-bar-widget-row">
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
    </li>
  );
}
