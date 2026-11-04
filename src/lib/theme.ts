"use client";

import { useSyncExternalStore } from "react";

// Light, dark or the computer's own setting ("system"). The choice is kept in this browser;
// <html data-theme> holds the theme in use ("light" / "dark"), set before the first paint by
// THEME_SCRIPT (lib/theme-script.ts) in app/layout.tsx so the page never flashes the wrong colours.

export type ThemeChoice = "light" | "dark" | "system";

const KEY = "theme";
const listeners = new Set<() => void>();
/** Kept here too when the browser can't store it (private window) */
let memory: ThemeChoice = "system";

const isChoice = (v: unknown): v is ThemeChoice => v === "light" || v === "dark" || v === "system";

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return isChoice(v) ? v : memory;
  } catch {
    return memory;
  }
}

const systemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;

function apply(choice: ThemeChoice) {
  document.documentElement.dataset.theme = choice === "dark" || (choice === "system" && systemDark()) ? "dark" : "light";
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  // "System" follows the computer when it switches between light and dark
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystem = () => {
    apply(readChoice());
    onChange();
  };
  media.addEventListener("change", onSystem);
  return () => {
    listeners.delete(onChange);
    media.removeEventListener("change", onSystem);
  };
}

export function setTheme(choice: ThemeChoice) {
  memory = choice;
  try {
    localStorage.setItem(KEY, choice);
  } catch {
    // Not remembered after a reload; still changes now
  }
  apply(choice);
  listeners.forEach((l) => l());
}

/** The theme picked (light / dark / system); "system" on the server */
export function useThemeChoice() {
  return useSyncExternalStore(subscribe, readChoice, () => "system" as const);
}
