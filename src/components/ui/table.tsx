"use client";

import { useLayoutEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Wraps a table so that on phones each row shows as a card of "column name: value" lines
 * (CSS in globals.css, .stack-table). Each cell's column name is copied from the header into
 * data-label after every render, since rows come and go. Cells spanning several columns
 * (empty states, group headings) get no name and stay plain.
 */
export function StackBox({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    for (const table of ref.current?.querySelectorAll("table") ?? []) {
      const head = table.tHead?.rows[table.tHead.rows.length - 1];
      if (!head) continue;
      const names: string[] = [];
      for (const th of head.cells) {
        // Screen-reader-only header text ("Actions") isn't a visible column name
        const copy = th.cloneNode(true) as HTMLElement;
        copy.querySelectorAll(".sr-only").forEach((el) => el.remove());
        for (let i = 0; i < th.colSpan; i++) names.push(copy.textContent?.trim() ?? "");
      }
      for (const body of table.tBodies) {
        for (const row of body.rows) {
          let col = 0;
          for (const cell of row.cells) {
            if (cell.colSpan > 1) cell.removeAttribute("data-label");
            else cell.dataset.label = names[col] ?? "";
            col += cell.colSpan;
          }
        }
      }
    }
  });
  return (
    <div ref={ref} className={cn("stack-table", className)}>
      {children}
    </div>
  );
}

export function Table({ className, children }: { className?: string; children: ReactNode }) {
  // `relative` keeps absolutely positioned children (e.g. sr-only labels) inside the
  // scroll box; otherwise they widen the whole page on small screens.
  return (
    <StackBox className={cn("relative overflow-x-auto", className)}>
      <table className="w-full border-collapse text-sm">{children}</table>
    </StackBox>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-brand-700 text-left text-xs font-semibold tracking-wide text-white uppercase">
      {children}
    </thead>
  );
}

export function TH({ className, ...props }: ComponentProps<"th">) {
  return <th className={cn("px-3 py-3 font-semibold whitespace-nowrap first:pl-5 last:pr-5", className)} {...props} />;
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-slate-200 bg-white">{children}</tbody>;
}

export function TR({ className, ...props }: ComponentProps<"tr">) {
  return <tr className={cn("transition-colors hover:bg-brand-50/60", className)} {...props} />;
}

export function TD({ className, ...props }: ComponentProps<"td">) {
  return <td className={cn("px-3 py-3 whitespace-nowrap text-slate-700 first:pl-5 last:pr-5", className)} {...props} />;
}

/** A heading row inside a table body, e.g. the item category the rows below are under */
export function GroupRow({ colSpan, className, children }: { colSpan: number; className?: string; children: ReactNode }) {
  return (
    <tr className={cn("bg-slate-100", className)}>
      <td colSpan={colSpan} className="px-5 py-1.5 text-xs font-semibold tracking-wide text-brand-800 uppercase">
        {children}
      </td>
    </tr>
  );
}

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-4 py-12 text-center text-sm text-slate-500">
        {children}
      </td>
    </tr>
  );
}

/** Right-aligned icon buttons at the end of a row */
export function RowActions({ children }: { children: ReactNode }) {
  return <div className="flex items-center justify-end gap-1">{children}</div>;
}
