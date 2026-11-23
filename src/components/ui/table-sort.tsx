"use client";

import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import {
  cloneElement,
  createContext,
  Fragment,
  isValidElement,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

/**
 * Click-to-sort for any table, without each page writing its own sort code.
 *
 * A header with visible text sorts its column: ascending, descending, then back to the page's own order.
 * Rows are sorted by what their cell shows (numbers, Rs. amounts, % and dd/mm/yyyy dates by value; an
 * input or select by its value), read from the page when the header is clicked and again whenever the
 * rows change. Only rows a page lists from an array (`list.map(...)`, each with a key) move; totals,
 * group headings and "nothing here" rows keep their place, and grouped rows are sorted within their group.
 */

type Dir = "asc" | "desc";
type Sort = { col: number; dir: Dir; by: string } | null;
type SortValue = { n: number | null; s: string } | null;
type Values = Map<string, SortValue>;

type SortState = {
  sort: Sort;
  values: Values;
  /** Sort by a header (`th`), or stop sorting (null) */
  sortBy: (th: HTMLTableCellElement, next: Sort) => void;
  /** Read the sorted column again (the rows changed) */
  reread: (table: HTMLTableElement | null) => void;
};

const SortContext = createContext<SortState | null>(null);

// ---------- Reading cells ----------

const DATE = /^(?:[A-Za-z]{3},?\s+)?(\d{1,2})\/(\d{1,2})\/(\d{4})\b/;
const NUMBER = /^(?:Rs\.?\s*)?([+-]?\d[\d,]*(?:\.\d+)?)\s*(?:%|units?|pcs|items?)?$/i;

function cellValue(cell: HTMLTableCellElement | undefined): SortValue {
  if (!cell) return null;
  const field = cell.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(
    'input:not([type="checkbox"]):not([type="radio"]), select, textarea',
  );
  const raw = field
    ? field instanceof HTMLSelectElement
      ? (field.selectedOptions[0]?.text ?? "")
      : field.value
    : cell.innerText || cell.textContent || "";
  // A cell's first line is its value ("24" over "6,453 units", a name over its pack size)
  const text =
    raw
      .split("\n")
      .map((t) => t.trim())
      .find(Boolean) ?? "";
  if (!text || /^[—–-]$/.test(text)) return null;
  const date = DATE.exec(text);
  if (date) return { n: Number(date[3]) * 10000 + Number(date[2]) * 100 + Number(date[1]), s: text };
  const num = NUMBER.exec(text);
  if (num) return { n: Number(num[1].replace(/,/g, "")), s: text };
  return { n: null, s: text.toLowerCase() };
}

/** The cell covering column `col`, counting cells that span several columns */
function cellAt(row: HTMLTableRowElement, col: number) {
  let at = 0;
  for (const cell of row.cells) {
    const span = cell.colSpan || 1;
    if (col < at + span) return cell;
    at += span;
  }
  return undefined;
}

/** The column a header cell starts at, counting the cells before it that span several columns */
function columnOf(cell: HTMLTableCellElement) {
  let col = 0;
  for (let c = cell.previousElementSibling; c; c = c.previousElementSibling) col += (c as HTMLTableCellElement).colSpan || 1;
  return col;
}

/** Every listed row's cell in column `col` */
function readTable(table: HTMLTableElement | null, col: number): Values {
  const values: Values = new Map();
  for (const row of table?.querySelectorAll<HTMLTableRowElement>(":scope > tbody > tr[data-sort-row]") ?? []) {
    values.set(row.dataset.sortRow!, cellValue(cellAt(row, col)));
  }
  return values;
}

function sameValues(a: Values, b: Values) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (!b.has(k)) return false;
    const w = b.get(k)!;
    if ((v === null) !== (w === null) || (v && w && (v.n !== w.n || v.s !== w.s))) return false;
  }
  return true;
}

/** Holds one table's sort; `Table` has one built in, raw <table>s wrap themselves in it */
export function SortScope({ children }: { children: ReactNode }) {
  const [sort, setSort] = useState<Sort>(null);
  const [values, setValues] = useState<Values>(() => new Map());
  const sortBy = useCallback((th: HTMLTableCellElement, next: Sort) => {
    setSort(next);
    setValues(next ? readTable(th.closest("table"), next.col) : new Map());
  }, []);
  const reread = useCallback(
    (table: HTMLTableElement | null) => {
      if (!sort) return;
      const next = readTable(table, sort.col);
      setValues((v) => (sameValues(v, next) ? v : next));
    },
    [sort],
  );
  const value = useMemo(() => ({ sort, values, sortBy, reread }), [sort, values, sortBy, reread]);
  return <SortContext.Provider value={value}>{children}</SortContext.Provider>;
}

// ---------- Header ----------

/** Header content a person can read (not sr-only labels or a tick-all box) */
function hasVisibleText(node: ReactNode): boolean {
  if (typeof node === "string") return node.trim() !== "";
  if (typeof node === "number") return true;
  if (Array.isArray(node)) return node.some(hasVisibleText);
  if (!isValidElement(node)) return false;
  const props = node.props as { className?: string; children?: ReactNode };
  if (node.type === "input" || props.className?.split(/\s+/).includes("sr-only")) return false;
  return hasVisibleText(props.children);
}

/** A column sorted by its data (useRowSort): the whole list is sorted, not just the rows on screen */
export type ColumnSort = { dir: Dir | null; toggle: () => void };

/**
 * A <th> that sorts its column. With `sort` (from useRowSort) it sorts the page's data, every page of
 * it; without, the rows on screen by what their cells show. `sortable={false}` for one that shouldn't.
 */
export function SortTh({
  sortable = true,
  sort,
  className,
  children,
  onClick,
  title,
  ...props
}: ComponentProps<"th"> & { sortable?: boolean; sort?: ColumnSort }) {
  const ctx = useContext(SortContext);
  const id = useId();
  if (!sort && (!ctx || !sortable || !hasVisibleText(children))) {
    return (
      <th className={className} onClick={onClick} title={title} {...props}>
        {children}
      </th>
    );
  }
  const dir = sort ? sort.dir : ctx!.sort?.by === id ? ctx!.sort.dir : null;
  function toggle(e: MouseEvent<HTMLTableCellElement>) {
    onClick?.(e);
    if (sort) return sort.toggle();
    const th = e.currentTarget;
    const col = columnOf(th);
    ctx!.sortBy(th, dir === null ? { col, dir: "asc", by: id } : dir === "asc" ? { col, dir: "desc", by: id } : null);
  }
  const Icon = dir === "asc" ? ArrowUp : dir === "desc" ? ArrowDown : ArrowUpDown;
  const right = /\btext-right\b/.test(className ?? "");
  return (
    <th
      className={cn("group/sort cursor-pointer select-none hover:text-slate-800", dir && "text-slate-900", className)}
      aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : undefined}
      onClick={toggle}
      title={title ?? (dir === "asc" ? "Sorted low to high: click for high to low" : dir === "desc" ? "Sorted high to low: click for the usual order" : "Click to sort")}
      {...props}
    >
      <span className={cn("inline-flex items-center gap-1", right && "flex-row-reverse")}>
        <span>{children}</span>
        <Icon className={cn("size-3 shrink-0", dir ? "text-brand-600" : "text-slate-300 opacity-0 group-hover/sort:opacity-100")} aria-hidden />
      </span>
    </th>
  );
}

// ---------- Sorting a list's data (tables shown a page at a time) ----------

type SortKey = string | number | null | undefined;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Blank values last either way; numbers by value, words in dictionary order (ORD - 2 before ORD - 10) */
function compareKeys(a: SortKey, b: SortKey, dir: Dir) {
  const blank = (v: SortKey) => v === null || v === undefined || v === "" || (typeof v === "number" && !Number.isFinite(v));
  if (blank(a) || blank(b)) return blank(a) ? (blank(b) ? 0 : 1) : -1;
  const d = typeof a === "number" && typeof b === "number" ? a - b : collator.compare(String(a), String(b));
  return dir === "asc" ? d : -d;
}

/**
 * Sorts a whole list by the column clicked, before it's cut into pages, so page 1 shows the first of
 * everything. `by` gives each sortable column's value for a row (a number, a date as yyyy-mm-dd, or text).
 * Put `sorter.key` in the pager's filters so it goes back to page 1, and `sort={sorter.column("name")}` on the TH.
 */
export function useRowSort<T, K extends string>(rows: T[], by: Record<K, (row: T) => SortKey>) {
  const [sort, setSort] = useState<{ key: K; dir: Dir } | null>(null);
  let sorted = rows;
  if (sort) {
    const value = by[sort.key];
    sorted = rows
      .map((row, i) => ({ row, i, v: value(row) }))
      .sort((a, b) => compareKeys(a.v, b.v, sort.dir) || a.i - b.i)
      .map((x) => x.row);
  }
  return {
    rows: sorted,
    /** Sorted by a column (the page's own grouping and order are off) */
    active: sort !== null,
    /** Changes when the sort does: for the pager's filters */
    key: sort ? `${sort.key}:${sort.dir}` : "",
    column: (key: K): ColumnSort => {
      const dir = sort?.key === key ? sort.dir : null;
      return { dir, toggle: () => setSort(dir === null ? { key, dir: "asc" } : dir === "asc" ? { key, dir: "desc" } : null) };
    },
  };
}

// ---------- Body ----------

/** Whether the table is sorted on screen: group headings hide meanwhile (they'd sit between unrelated rows) */
export function useTableSorted() {
  return !!useContext(SortContext)?.sort;
}

/** Marks a row component that is only a heading (GroupRow): never read as a row, hidden while sorted */
export function sortSkip<T extends object>(component: T): T {
  (component as { sortSkip?: boolean }).sortSkip = true;
  return component;
}
const skipped = (el: ReactElement) => typeof el.type === "function" && (el.type as { sortSkip?: boolean }).sortSkip === true;

/** Blank cells last either way; numbers by value, words in dictionary order */
function compare(a: SortValue, b: SortValue, dir: Dir) {
  if (!a || !b) return a ? -1 : b ? 1 : 0;
  const d = a.n !== null && b.n !== null ? a.n - b.n : a.n !== null ? -1 : b.n !== null ? 1 : collator.compare(a.s, b.s);
  return dir === "asc" ? d : -d;
}

const isEmpty = (n: ReactNode) => n === null || n === undefined || typeof n === "boolean";
const childrenOf = (el: ReactElement) => (el.props as { children?: ReactNode }).children;

/** A keyed fragment holding a list of rows (a heading and the rows under it), not one row with its detail rows */
function isGroup(el: ReactElement): boolean {
  const has = (n: ReactNode): boolean =>
    Array.isArray(n) ? n.some((c) => Array.isArray(c) || has(c)) : isValidElement(n) && n.type === Fragment && has(childrenOf(n));
  return has(childrenOf(el));
}

/** One row the page listed from an array (with any detail rows that go with it), tagged so its cell can be read */
type Unit = { id: string; el: ReactElement };

const withTag = (el: ReactElement, id: string) => cloneElement(el as ReactElement<{ "data-sort-row"?: string }>, { "data-sort-row": id });

/**
 * Tags every listed row with `data-sort-row` (kept in place), and collects them as units.
 * `units` is null when the table has nothing to sort.
 */
function tagRows(node: ReactNode, path: string, units: Unit[]): ReactNode {
  if (Array.isArray(node)) {
    return node.map((child, i) => {
      if (isValidElement(child) && child.key !== null && !skipped(child)) {
        const id = `${path}/${child.key}`;
        if (child.type === Fragment) {
          // A group (heading + its rows): its rows are the units
          if (isGroup(child)) return cloneElement(child, undefined, tagRows(childrenOf(child), `${id}~`, units));
          // One row and its detail rows: tag the row (not a heading before it); they move together
          let done = false;
          const parts = ([] as ReactNode[]).concat(childrenOf(child)).map((c) => {
            if (done || !isValidElement(c) || skipped(c)) return c;
            done = true;
            return withTag(c, id);
          });
          const unit = cloneElement(child, undefined, ...parts);
          if (done) units.push({ id, el: unit });
          return unit;
        }
        const unit = withTag(child, id);
        units.push({ id, el: unit });
        return unit;
      }
      return tagRows(child, `${path}.${i}`, units);
    });
  }
  if (isValidElement(node) && node.type === Fragment) return cloneElement(node, undefined, tagRows(childrenOf(node), `${path}~`, units));
  return node;
}

/** What's left of the body once the rows are taken out: the rows before the list (e.g. "nothing here") and after it (totals) */
function fixedParts(node: ReactNode, ids: Set<string>, out: { before: ReactNode[]; after: ReactNode[]; seen: boolean }) {
  if (Array.isArray(node)) {
    for (const c of node) fixedParts(c, ids, out);
    return;
  }
  if (isEmpty(node)) return;
  if (isValidElement(node)) {
    const id = (node.props as { "data-sort-row"?: string })["data-sort-row"];
    if (id && ids.has(id)) {
      out.seen = true;
      return;
    }
    if (node.type === Fragment) {
      // A row with its detail rows: its tagged row is inside
      const inner = ([] as ReactNode[]).concat(childrenOf(node)).find((c) => isValidElement(c) && ids.has((c.props as { "data-sort-row"?: string })["data-sort-row"] ?? ""));
      if (inner) {
        out.seen = true;
        return;
      }
      return fixedParts(childrenOf(node), ids, out);
    }
    if (skipped(node)) return;
  }
  (out.seen ? out.after : out.before).push(node);
}

/** A <tbody> whose listed rows follow the table's sort */
export function SortTbody({ children, ...props }: ComponentProps<"tbody">) {
  const ctx = useContext(SortContext);
  const ref = useRef<HTMLTableSectionElement>(null);
  const reread = ctx?.reread;
  const sorted = !!ctx?.sort;

  // Rows added, changed or typed into while sorted: read the column again, then they follow the sort
  useEffect(() => {
    if (!sorted || !reread) return;
    const frame = requestAnimationFrame(() => reread(ref.current?.closest("table") ?? null));
    return () => cancelAnimationFrame(frame);
  });

  let body: ReactNode = children;
  if (ctx) {
    const units: Unit[] = [];
    const tagged = tagRows(children, "", units);
    body = tagged;
    // Sorted, and every row read: all the rows in order (across groups), with the fixed rows around them
    if (ctx.sort && units.length > 1 && units.every((u) => ctx.values.has(u.id))) {
      const dir = ctx.sort.dir;
      const out = { before: [] as ReactNode[], after: [] as ReactNode[], seen: false };
      fixedParts(tagged, new Set(units.map((u) => u.id)), out);
      const rows = units
        .map((u, i) => ({ u, i, v: ctx.values.get(u.id) ?? null }))
        .sort((a, b) => compare(a.v, b.v, dir) || a.i - b.i)
        .map(({ u }) => cloneElement(u.el, { key: u.id }));
      body = [...out.before.map((n, i) => (isValidElement(n) ? cloneElement(n, { key: `before-${i}` }) : n)), ...rows, ...out.after.map((n, i) => (isValidElement(n) ? cloneElement(n, { key: `after-${i}` }) : n))];
    }
  }

  return (
    <tbody ref={ref} {...props}>
      {body}
    </tbody>
  );
}
