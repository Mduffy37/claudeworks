import React from "react";
import { useTranslation } from "react-i18next";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { StatusLineWidget } from "../../../electron/types";

interface Props {
  /** Compound drag id, stable across renders at this index. */
  dragId: string;
  /** Position of this widget in the flat widget list. */
  widgetIndex: number;
  widget: StatusLineWidget;
  label: string;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}

export function SortableWidgetRow({
  dragId,
  widget,
  label,
  selected,
  onSelect,
  onDelete,
}: Props) {
  const { t } = useTranslation(["settings"]);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: dragId });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  // Break sentinel: render as a dashed section divider with its own
  // drag handle + delete button. Not toggleable, not selectable.
  if (widget.id === "break") {
    return (
      <li ref={setNodeRef} style={style} className="status-bar-break-row">
        <span
          className="status-bar-drag-handle"
          {...attributes}
          {...listeners}
          aria-label={t("settings:statusLine.dragBreak")}
        >
          ⋮⋮
        </span>
        <div className="status-bar-break-line">{t("settings:statusLine.sectionBreak")}</div>
        <button
          type="button"
          className="status-bar-break-delete"
          onClick={onDelete}
          aria-label={t("settings:statusLine.removeBreak")}
        >
          ×
        </button>
      </li>
    );
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`status-bar-widget-row${selected ? " selected" : ""}`}
      onClick={(e) => {
        if (
          (e.target as HTMLElement).closest(
            ".status-bar-drag-handle, .status-bar-row-delete",
          )
        ) {
          return;
        }
        onSelect();
      }}
    >
      <span
        className="status-bar-drag-handle"
        {...attributes}
        {...listeners}
        aria-label={t("settings:statusLine.reorder", { label })}
        onClick={(e) => e.stopPropagation()}
      >
        ⋮⋮
      </span>
      <span className="status-bar-widget-name">{label}</span>
      <button
        type="button"
        className="status-bar-row-delete"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        aria-label={t("settings:statusLine.remove", { label })}
      >
        ×
      </button>
    </li>
  );
}
