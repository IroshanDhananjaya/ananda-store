import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/utils";

const control =
  "w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-[0_1px_2px_rgb(16_18_27/0.04)] transition-[border-color,box-shadow] " +
  "placeholder:text-slate-400 hover:border-slate-300 focus:border-brand-500 focus:outline-none focus:ring-4 focus:ring-brand-500/15 " +
  "disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 " +
  "aria-[invalid=true]:border-red-400 aria-[invalid=true]:ring-red-500/20";

export function Input({ className, onWheel, ...props }: ComponentProps<"input">) {
  return (
    <input
      className={cn(control, "h-9 pointer-coarse:h-11", className)}
      // Scrolling the page with the mouse wheel over a number box would quietly change the number
      onWheel={(e) => {
        if (props.type === "number" && document.activeElement === e.currentTarget) e.currentTarget.blur();
        onWheel?.(e);
      }}
      {...props}
    />
  );
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cn(control, "h-9 pr-8 pointer-coarse:h-11", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(control, "min-h-20 py-2", className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  required,
  error,
  hint,
  className,
  children,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-slate-700">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-red-600">{error}</p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
}

/** Read-only value shown in a form, styled like a disabled input */
export function ReadOnlyValue({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex h-9 items-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 pointer-coarse:h-11",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function Checkbox({ label, description, ...props }: Omit<ComponentProps<"input">, "type"> & { label: string; description?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input type="checkbox" className="mt-0.5 size-4 shrink-0 cursor-pointer rounded accent-brand-600" {...props} />
      <span>
        <span className="block text-sm font-medium text-slate-700">{label}</span>
        {description && <span className="block text-xs text-slate-500">{description}</span>}
      </span>
    </label>
  );
}

/** Parse a numeric input; empty string becomes 0 */
export function toNumber(value: string) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}
