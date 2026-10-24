"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input } from "@/components/ui/form";
import { Card, PageHeader, SearchInput, TableFooter, Toolbar } from "@/components/ui/layout";
import { Modal } from "@/components/ui/modal";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, RowActions, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAppStore } from "@/lib/store";
import type { StoreLocation } from "@/lib/types";
import { useDialog } from "@/lib/use-dialog";
import { formatQty, includesText, nextLocationNumber } from "@/lib/utils";

function LocationForm({ location, onDone }: { location: StoreLocation | null; onDone: () => void }) {
  const locations = useAppStore((s) => s.locations);
  const addLocation = useAppStore((s) => s.addLocation);
  const updateLocation = useAppStore((s) => s.updateLocation);
  const [locationNumber, setLocationNumber] = useState(() => location?.locationNumber ?? nextLocationNumber(locations));
  const [itemGroup, setItemGroup] = useState(location?.itemGroup ?? "");
  const [errors, setErrors] = useState<{ locationNumber?: string; itemGroup?: string }>({});

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!locationNumber.trim()) next.locationNumber = "Location number is required.";
    if (!itemGroup.trim()) next.itemGroup = "Item group is required.";
    setErrors(next);
    if (Object.keys(next).length) return;

    const input = { locationNumber, itemGroup };
    const result = await (location ? updateLocation(location.id, input) : addLocation(input));
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(location ? "Location updated" : "Location added");
    onDone();
  }

  return (
    <form id="location-form" onSubmit={handleSubmit} className="grid gap-4" noValidate>
      <Field
        label="Location Number"
        htmlFor="locationNumber"
        required
        error={errors.locationNumber}
        hint={location ? "Location number can't be changed." : "Format: LOC - 001"}
      >
        <Input
          id="locationNumber"
          value={locationNumber}
          onChange={(e) => setLocationNumber(e.target.value)}
          disabled={!!location}
          className="uppercase"
          aria-invalid={!!errors.locationNumber}
        />
      </Field>
      <Field label="Item Group" htmlFor="itemGroup" required error={errors.itemGroup} hint="What is stored here, e.g. SOYA, SALT">
        <Input
          id="itemGroup"
          value={itemGroup}
          onChange={(e) => setItemGroup(e.target.value)}
          className="uppercase"
          aria-invalid={!!errors.itemGroup}
          autoFocus
        />
      </Field>
    </form>
  );
}

export function LocationsPage() {
  const locations = useAppStore((s) => s.locations);
  const items = useAppStore((s) => s.items);
  const stock = useAppStore((s) => s.stock);
  const deleteLocation = useAppStore((s) => s.deleteLocation);
  const [query, setQuery] = useState("");
  const form = useDialog<StoreLocation | "new">();
  const remove = useDialog<StoreLocation>();

  const usage = useMemo(() => {
    const map = new Map<string, { lines: number; qty: number }>();
    for (const r of stock) {
      const u = map.get(r.locationNumber) ?? { lines: 0, qty: 0 };
      map.set(r.locationNumber, { lines: u.lines + 1, qty: u.qty + r.availableQty });
    }
    return map;
  }, [stock]);

  const itemCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const i of items) if (i.locationNumber) map.set(i.locationNumber, (map.get(i.locationNumber) ?? 0) + 1);
    return map;
  }, [items]);

  const rows = locations.filter((l) => includesText([l.locationNumber, l.itemGroup], query));
  const editing = form.target === "new" ? null : form.target;

  const pager = usePagination(rows, [query]);

  return (
    <>
      <PageHeader
        title="Stock Locations"
        description="Racks / areas in the warehouse and the item group each one holds (your “Store Location” sheet)."
        actions={
          <Button onClick={() => form.open("new")}>
            <Plus /> Add location
          </Button>
        }
      />

      <Card>
        <Toolbar>
          <SearchInput placeholder="Search location or item group" value={query} onChange={(e) => setQuery(e.target.value)} />
        </Toolbar>
        <Table>
          <THead>
            <tr>
              <TH>Location Number</TH>
              <TH>Item Group</TH>
              <TH className="text-right">Items</TH>
              <TH className="text-right">Stock Lines</TH>
              <TH className="text-right">Available Qty</TH>
              <TH className="w-24">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={6}>No locations found.</EmptyRow>}
            {pager.pageRows.map((loc) => {
              const u = usage.get(loc.locationNumber);
              return (
                <TR key={loc.id}>
                  <TD className="font-medium text-slate-900">{loc.locationNumber}</TD>
                  <TD>{loc.itemGroup}</TD>
                  <TD className="text-right tabular-nums">{itemCount.get(loc.locationNumber) ?? 0}</TD>
                  <TD className="text-right tabular-nums">{u?.lines ?? 0}</TD>
                  <TD className="text-right tabular-nums">{formatQty(u?.qty ?? 0)}</TD>
                  <TD>
                    <RowActions>
                      <Button variant="ghost" size="icon" onClick={() => form.open(loc)} aria-label={`Edit ${loc.locationNumber}`}>
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="hover:bg-red-50 hover:text-red-600"
                        onClick={() => remove.open(loc)}
                        aria-label={`Delete ${loc.locationNumber}`}
                      >
                        <Trash2 />
                      </Button>
                    </RowActions>
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
        <TableFooter pager={<Pagination pager={pager} />}>
          {rows.length === locations.length ? locations.length : `${rows.length} of ${locations.length}`} locations
        </TableFooter>
      </Card>

      <Modal
        open={form.isOpen}
        onClose={form.close}
        title={editing ? `Edit ${editing.locationNumber}` : "Add location"}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={form.close}>
              Cancel
            </Button>
            <Button type="submit" form="location-form">
              {editing ? "Save changes" : "Add location"}
            </Button>
          </>
        }
      >
        <LocationForm key={editing?.id ?? "new"} location={editing} onDone={form.close} />
      </Modal>

      <ConfirmDialog
        open={remove.isOpen}
        onClose={remove.close}
        title="Delete location?"
        message={
          <>
            <span className="font-medium text-slate-900">{remove.target?.locationNumber}</span> ({remove.target?.itemGroup}) will
            be removed. Locations that still hold stock or items can&apos;t be deleted.
          </>
        }
        onConfirm={async () => {
          if (!remove.target) return;
          const result = await deleteLocation(remove.target.id);
          if (result.ok) toast.success("Location deleted");
          else toast.error(result.error);
          remove.close();
        }}
      />
    </>
  );
}
