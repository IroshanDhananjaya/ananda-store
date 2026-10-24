"use client";

import { useCallback, useLayoutEffect, useState } from "react";

// Next.js (cacheComponents) keeps recently visited routes mounted inside
// <Activity>, so component state survives navigation. These hooks reset
// transient state when the route is hidden.

/**
 * Open/close state for a dialog that targets a record.
 * Resets when the route is hidden, so a dialog is never still open when you navigate back.
 */
export function useDialog<T>() {
  const [target, setTarget] = useState<T | null>(null);
  useLayoutEffect(() => () => setTarget(null), []);
  const close = useCallback(() => setTarget(null), []);
  return { target, open: setTarget, close, isOpen: target !== null };
}

/**
 * A React key that changes whenever the route is hidden or `reset()` is called.
 * Put it on a form to remount it with fresh data from the store.
 */
export function useResetKey({ onHide = true }: { onHide?: boolean } = {}) {
  const [key, setKey] = useState(0);
  useLayoutEffect(() => {
    if (!onHide) return;
    return () => setKey((k) => k + 1);
  }, [onHide]);
  const reset = useCallback(() => setKey((k) => k + 1), []);
  return { key, reset };
}
