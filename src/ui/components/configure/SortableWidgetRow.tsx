import React from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { StatusLineWidget } from "../../../electron/types";

interface Props {
  sectionId: string;
  widget: StatusLineWidget;
  label: string;
  selected: boolean;
  onToggle: (enabled: boolean) => void;
  onSelect: () => void;
}

export function SortableWidgetRow({
  sectionId,
  widget,
  label,
  selected,
  onToggle,
  onSelect,
}: Props) {
  const id = `${sectionId}:${widget.id}`;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`status-bar-widget-row${selected ? " selected" : ""}`}
      onClick={(e) => {
        // Don't select when clicking the drag handle or the checkbox (those
        // have their own handlers via stopPropagation below).
        if ((e.target as HTMLElement).closest(".status-bar-drag-handle, input")) {
          return;
        }
        onSelect();
      }}
    >
      <span
        className="status-bar-drag-handle"
        {...attributes}
        {...listeners}
        aria-label="Drag to reorder"
        onClick={(e) => e.stopPropagation()}
      >
        ⋮⋮
      </span>
      <label onClick={(e) => e.stopPropagation()}>
        <input
          type="checkbox"
          checked={widget.enabled}
          onChange={(e) => onToggle(e.target.checked)}
          onClick={(e) => e.stopPropagation()}
        />
        <span className="status-bar-widget-name">{label}</span>
      </label>
    </li>
  );
}
