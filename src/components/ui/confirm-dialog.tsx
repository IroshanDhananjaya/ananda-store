"use client";

import { useState, type ReactNode } from "react";
import { Button } from "./button";
import { Modal } from "./modal";

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Delete",
  tone = "danger",
}: {
  open: boolean;
  onClose: () => void;
  /** May return a promise; the button shows "Saving…" until it settles */
  onConfirm: () => void | Promise<void>;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  tone?: "danger" | "primary";
}) {
  const [busy, setBusy] = useState(false);
  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      footer={
        <>
          {/* Enter on a delete question means Cancel, so a habit Enter can't delete */}
          <Button variant="outline" onClick={onClose} autoFocus={tone === "danger"}>
            Cancel
          </Button>
          <Button variant={tone} onClick={confirm} disabled={busy} autoFocus={tone !== "danger"}>
            {busy ? "Saving…" : confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm text-slate-600">{message}</div>
    </Modal>
  );
}
