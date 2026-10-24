"use client";

import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { Modal } from "@/components/ui/modal";
import { useAppStore } from "@/lib/store";
import { WEEK_DAYS, type Route, type WeekDay } from "@/lib/types";
import { cn, nextCode } from "@/lib/utils";

type Values = {
  routeCode: string;
  routeName: string;
  area: string;
  visitDays: WeekDay[];
  salesRep: string;
  vehicleNumber: string;
  active: boolean;
};

function RouteForm({ route, onDone }: { route: Route | null; onDone: () => void }) {
  const routes = useAppStore((s) => s.routes);
  const addRoute = useAppStore((s) => s.addRoute);
  const updateRoute = useAppStore((s) => s.updateRoute);
  const [values, setValues] = useState<Values>(() => ({
    routeCode: route?.routeCode ?? nextCode(routes.map((r) => r.routeCode), "RT", 3),
    routeName: route?.routeName ?? "",
    area: route?.area ?? "",
    visitDays: route?.visitDays ?? [],
    salesRep: route?.salesRep ?? "",
    vehicleNumber: route?.vehicleNumber ?? "",
    active: route?.active ?? true,
  }));
  const [errors, setErrors] = useState<{ routeCode?: string; routeName?: string }>({});
  const set = (key: keyof Values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  const toggleDay = (day: WeekDay) =>
    setValues((v) => ({
      ...v,
      visitDays: v.visitDays.includes(day)
        ? v.visitDays.filter((d) => d !== day)
        : WEEK_DAYS.filter((d) => d === day || v.visitDays.includes(d)),
    }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!values.routeCode.trim()) next.routeCode = "Route number is required.";
    if (!values.routeName.trim()) next.routeName = "Route name is required.";
    setErrors(next);
    if (Object.keys(next).length) return;

    const input = {
      ...values,
      area: values.area.trim(),
      salesRep: values.salesRep.trim(),
      vehicleNumber: values.vehicleNumber.trim().toUpperCase(),
    };
    const result = await (route ? updateRoute(route.id, input) : addRoute(input));
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(route ? "Route updated" : "Route added");
    onDone();
  }

  return (
    <form id="route-form" onSubmit={handleSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
      <Field label="Route Number" htmlFor="routeCode" required error={errors.routeCode}>
        <Input id="routeCode" value={values.routeCode} onChange={set("routeCode")} className="uppercase" aria-invalid={!!errors.routeCode} />
      </Field>
      <Field label="Route Name" htmlFor="routeName" required error={errors.routeName}>
        <Input id="routeName" value={values.routeName} onChange={set("routeName")} placeholder="Kurunegala Town" aria-invalid={!!errors.routeName} autoFocus />
      </Field>
      <Field label="Area / Towns" htmlFor="area" className="sm:col-span-2" hint="Towns or areas this route covers">
        <Input id="area" value={values.area} onChange={set("area")} />
      </Field>
      <Field label="Visit Days" className="sm:col-span-2">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Visit days">
          {WEEK_DAYS.map((day) => {
            const on = values.visitDays.includes(day);
            return (
              <button
                key={day}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDay(day)}
                className={cn(
                  "h-9 w-12 rounded-lg border text-sm font-medium transition-colors",
                  on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50",
                )}
              >
                {day}
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="Sales Rep" htmlFor="salesRep">
        <Input id="salesRep" value={values.salesRep} onChange={set("salesRep")} />
      </Field>
      <Field label="Vehicle Number" htmlFor="vehicle">
        <Input id="vehicle" value={values.vehicleNumber} onChange={set("vehicleNumber")} className="uppercase" placeholder="WP LB-4521" />
      </Field>
      <div className="sm:col-span-2">
        <Checkbox label="Active" checked={values.active} onChange={(e) => setValues((v) => ({ ...v, active: e.target.checked }))} />
      </div>
    </form>
  );
}

export function RouteFormDialog({ route, open, onClose }: { route: Route | null; open: boolean; onClose: () => void }) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={route ? `Edit ${route.routeCode}` : "Add route"}
      description="A delivery route and the days it is visited."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="route-form">
            {route ? "Save changes" : "Add route"}
          </Button>
        </>
      }
    >
      <RouteForm key={route?.id ?? "new"} route={route} onDone={onClose} />
    </Modal>
  );
}
