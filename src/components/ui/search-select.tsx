"use client";

import { Check, ChevronDown, Plus } from "lucide-react";
import { Fragment, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

export type SearchOption = {
  value: string;
  label: string;
  /** Second line in the list (e.g. item name); searched too */
  description?: string;
  /** Small note on the right of the list (e.g. pack size, stock on hand); searched too */
  hint?: string;
  disabled?: boolean;
  /** Heading it's listed under (e.g. item category); options of a group must be next to each other. Searched too. */
  group?: string;
};

const squash = (s: string) => s.replace(/[^a-z0-9]/g, "");

/**
 * Every typed word must appear somewhere, so "chi 90" finds "RM-CHI-SOY-90G · Chicken Soya - 90gr".
 * Spaces and dashes don't matter, so "cuttlefish" finds "Cuttle Fish Soya" and "rmcut" finds "RM-CUT-SOY-90G".
 */
function matches(o: SearchOption, query: string) {
  const text = `${o.label} ${o.description ?? ""} ${o.hint ?? ""} ${o.group ?? ""}`.toLowerCase();
  const squashed = squash(text);
  return query
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word) || squashed.includes(squash(word)));
}

/** Value of the "add new" row at the end of the list; can't clash with a real option */
const CREATE = "\u0000create";

const firstEnabled = (list: SearchOption[], from = 0) => {
  const i = list.findIndex((o, n) => n >= from && !o.disabled);
  return i === -1 ? 0 : i;
};

/**
 * A dropdown you can type into to search, for long lists such as items.
 * The box's text is only the search; the picked option shows as its placeholder.
 * The list is position: fixed so table scroll boxes and dialogs don't cut it off.
 */
export function SearchSelect({
  id,
  value,
  onChange,
  options,
  placeholder = "Select…",
  showDescription = false,
  onCreate,
  createLabel = (text) => (text ? `Add “${text}”` : "Add new"),
  className,
  autoFocus,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SearchOption[];
  placeholder?: string;
  /** Show the picked option's description in the box too (when nothing else on screen shows it) */
  showDescription?: boolean;
  /** Adds an "add new" row at the end of the list (hidden when the typed text is an option's exact name); gets the typed text */
  onCreate?: (text: string) => void;
  /** Text of the "add new" row for the typed text ("" when nothing is typed) */
  createLabel?: (text: string) => string;
  className?: string;
  autoFocus?: boolean;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
}) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const selected = options.find((o) => o.value === value);
  const selectedText = selected ? (showDescription && selected.description ? `${selected.label} · ${selected.description}` : selected.label) : "";
  const typed = query.trim();
  const filtered = query ? options.filter((o) => matches(o, query)) : options;
  const exactMatch = typed !== "" && options.some((o) => o.label.toLowerCase() === typed.toLowerCase());
  const shown = onCreate && !exactMatch ? [...filtered, { value: CREATE, label: createLabel(typed) }] : filtered;

  // Under the box, or above it when there's more room there; follows scrolling
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const input = inputRef.current;
      const list = listRef.current;
      if (!input || !list) return;
      const r = input.getBoundingClientRect();
      const width = Math.min(Math.max(r.width, 320), window.innerWidth - 16);
      const below = window.innerHeight - r.bottom - 12;
      const above = r.top - 12;
      const up = below < 240 && above > below;
      Object.assign(list.style, {
        left: `${Math.min(Math.max(8, r.left), window.innerWidth - width - 8)}px`,
        width: `${width}px`,
        top: up ? "" : `${r.bottom + 4}px`,
        bottom: up ? `${window.innerHeight - r.top + 4}px` : "",
        maxHeight: `${Math.min(320, up ? above : below)}px`,
      });
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (open) listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function openList() {
    setOpen(true);
    setQuery("");
    const current = options.findIndex((o) => o.value === value);
    setActive(current === -1 ? firstEnabled(options) : current);
  }

  function close() {
    setOpen(false);
    setQuery("");
  }

  function choose(o: SearchOption | undefined) {
    if (!o || o.disabled) return;
    if (o.value === CREATE) onCreate?.(typed);
    else onChange(o.value);
    close();
  }

  function move(step: 1 | -1) {
    for (let i = active + step; i >= 0 && i < shown.length; i += step) {
      if (!shown[i].disabled) return setActive(i);
    }
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) openList();
      else move(e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "Enter") {
      // Like a normal dropdown, Enter never submits the form
      e.preventDefault();
      if (open) choose(shown[active]);
      else openList();
    } else if (e.key === "Escape" && open) {
      // Close just the list; Modal skips an Esc that was already handled (defaultPrevented)
      e.preventDefault();
      close();
    } else if (e.key === "Tab" && open) {
      // Tab takes the highlighted match, but never opens "add new" by surprise
      if (query && shown[active]?.value !== CREATE) choose(shown[active]);
      else close();
    }
  }

  return (
    <div className="relative">
      <input
        ref={inputRef}
        id={id}
        type="text"
        role="combobox"
        aria-label={ariaLabel}
        aria-invalid={ariaInvalid}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? `${listId}-${active}` : undefined}
        autoComplete="off"
        autoFocus={autoFocus}
        value={query}
        placeholder={open ? "Search code or name…" : selectedText || placeholder}
        onChange={(e) => {
          const q = e.target.value;
          setQuery(q);
          setActive(firstEnabled(q ? options.filter((o) => matches(o, q)) : options));
          setOpen(true);
        }}
        onClick={() => !open && openList()}
        onBlur={close}
        onKeyDown={onKeyDown}
        className={cn(
          "h-10 w-full truncate rounded-lg border border-slate-300 bg-white pr-8 pl-3 text-sm shadow-sm",
          "focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none",
          "aria-[invalid=true]:border-red-400 aria-[invalid=true]:ring-red-500/20",
          // The picked option is the placeholder (read out to screen readers) but drawn by the span below
          selected && !open ? "placeholder:text-transparent" : "placeholder:text-slate-400",
          className,
        )}
      />
      {/* The picked option over the empty box: its label bold, then its description */}
      {selected && !open && (
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-8 left-3 flex min-w-0 items-center gap-1.5 overflow-hidden text-sm whitespace-nowrap">
          {/* In a narrow box the description gives way first, so the label stays readable */}
          <span className="max-w-full min-w-0 shrink-0 truncate font-semibold text-slate-900">{selected.label}</span>
          {showDescription && selected.description && <span className="min-w-0 truncate text-slate-500">· {selected.description}</span>}
        </span>
      )}
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-slate-400" />
      {open && (
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          // Keep focus in the box so clicking an option (or the scrollbar) doesn't close the list first
          onMouseDown={(e) => e.preventDefault()}
          className="fixed z-[60] overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 text-sm shadow-lg"
        >
          {shown.length === 0 && <li className="px-3 py-2 text-slate-500">No matches for “{query}”</li>}
          {shown.map((o, i) => (
            <Fragment key={o.value}>
              {/* A heading where the group changes (not an option: the arrow keys skip it) */}
              {o.group && o.group !== shown[i - 1]?.group && (
                <li
                  role="presentation"
                  className={cn("px-3 pt-2 pb-1 text-[11px] font-semibold tracking-wide text-brand-700 uppercase", i > 0 && "mt-1 border-t border-slate-100")}
                >
                  {o.group}
                </li>
              )}
              {o.value === CREATE ? (
                <li
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={false}
                  onMouseMove={() => i !== active && setActive(i)}
                  onClick={() => choose(o)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-3 py-2 font-medium text-brand-700",
                    i > 0 && "border-t border-slate-100",
                    i === active && "bg-brand-50",
                  )}
                >
                  <Plus className="size-4 shrink-0" />
                  <span className="truncate">{o.label}</span>
                </li>
              ) : (
                <li
                  id={`${listId}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={o.value === value}
                  aria-disabled={o.disabled}
                  onMouseMove={() => !o.disabled && i !== active && setActive(i)}
                  onClick={() => choose(o)}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 px-3 py-1.5",
                    i === active && !o.disabled && "bg-brand-50",
                    o.disabled && "cursor-not-allowed opacity-45",
                  )}
                >
                  <Check className={cn("size-4 shrink-0 text-brand-600", o.value !== value && "invisible")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold text-slate-900">{o.label}</span>
                    {o.description && <span className="block truncate text-xs text-slate-500">{o.description}</span>}
                  </span>
                  {o.hint && <span className="shrink-0 text-xs text-slate-500 tabular-nums">{o.hint}</span>}
                </li>
              )}
            </Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}
