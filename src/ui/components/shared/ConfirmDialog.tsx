import React, { useEffect, useRef } from "react";

interface Props {
  title: string;
  description: string | React.ReactNode;
  confirmLabel: string;
  confirmVariant?: "danger" | "primary";
  onConfirm: () => void;
  onCancel: () => void;
  extraLabel?: string;
  onExtra?: () => void;
}

export function ConfirmDialog({
  title,
  description,
  confirmVariant = "danger",
  confirmLabel,
  onConfirm,
  onCancel,
  extraLabel,
  onExtra,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal-dialog modal-confirm"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="modal-header">
          <span className="modal-title" id="confirm-title">{title}</span>
          <button className="modal-close" onClick={onCancel} aria-label="Close">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <p className="modal-description">{description}</p>
          <div className="modal-confirm-actions">
            <button className="btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            {extraLabel && onExtra && (
              <button className="btn-primary" onClick={onExtra}>
                {extraLabel}
              </button>
            )}
            <button
              className={confirmVariant === "danger" ? "btn-danger" : "btn-primary"}
              onClick={onConfirm}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
