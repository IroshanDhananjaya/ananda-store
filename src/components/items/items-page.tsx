"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { toast } from "@/lib/toast";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/form";
import { Card, PageHeader, SearchInput, TableFooter, Toolbar } from "@/components/ui/layout";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, GroupRow, RowActions, Table, TBody, TD, TH, THead, TR, useRowSort } from "@/components/ui/table";
import { categoryOf, compareByCategory } from "@/lib/categories";
import { useAppStore, useCategoryRanks } from "@/lib/store";
import type { Item } from "@/lib/types";
import { useDialog } from "@/lib/use-dialog";
import { formatMoney, formatQty, includesText } from "@/lib/utils";
import { ItemFormDialog } from "./item-form-dialog";

/** Location filter value for items with no stock location */
const NOT_SET = "none";

export function ItemsPage() {
  const items = useAppStore((s) => s.items);
  const stock = useAppStore((s) => s.stock);
  const locations = useAppStore((s) => s.locations);
  const deleteItem = useAppStore((s) => s.deleteItem);
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [category, setCategory] = useState("");
  const ranks = useCategoryRanks();
  const form = useDialog<Item | "new">();
  const remove = useDialog<Item>();

  const availableBySap = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of stock) map.set(r.sapCode, (map.get(r.sapCode) ?? 0) + r.availableQty);
    return map;
  }, [stock]);

  const notSet = items.filter((i) => !i.locationNumber).length;
  // Under their categories (Raigam's order sheet sections), in the sheet's order
  const rows = items
    .filter(
      (i) =>
        (!location || i.locationNumber === (location === NOT_SET ? "" : location)) &&
        (!category || categoryOf(i) === category) &&
        includesText([i.sapCode, i.description, i.packageDetails, i.uom, categoryOf(i)], query),
    )
    .sort((a, b) => compareByCategory(ranks, a, b));
  const perCategory = Map.groupBy(rows, categoryOf);

  // A column header sorts every item (not just this page); the category headings step aside meanwhile
  const sorter = useRowSort(rows, {
    code: (i) => i.sapCode,
    name: (i) => i.description,
    pack: (i) => i.packageDetails,
    uom: (i) => i.uom,
    location: (i) => i.locationNumber,
    cost: (i) => (i.costPrice > 0 ? i.costPrice : null),
    wholesale: (i) => i.wholesalePrice,
    retail: (i) => (i.retailPrice > 0 ? i.retailPrice : null),
    stock: (i) => availableBySap.get(i.sapCode) ?? 0,
  });
  const pager = usePagination(sorter.rows, [query, location, category, sorter.key]);

  return (
    <>
      <PageHeader
        title="Items"
        description="Product master: SAP codes, packaging, cost and selling prices."
        actions={
          <Button onClick={() => form.open("new")}>
            <Plus /> Add item
          </Button>
        }
      />

      <Card>
        <Toolbar>
          <SearchInput placeholder="Search SAP code or description" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Select value={location} onChange={(e) => setLocation(e.target.value)} className="h-9 sm:w-56" aria-label="Filter by stock location">
            <option value="">All locations</option>
            <option value={NOT_SET}>Location not set ({notSet})</option>
            {locations.map((l) => (
              <option key={l.id} value={l.locationNumber}>
                {l.locationNumber} · {l.itemGroup}
              </option>
            ))}
          </Select>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 sm:w-56" aria-label="Filter by category">
            <option value="">All categories</option>
            {[...ranks.keys()].map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </Toolbar>
        <Table>
          <THead>
            <tr>
              <TH sort={sorter.column("code")}>SAP Code</TH>
              <TH sort={sorter.column("name")}>Item Description</TH>
              <TH sort={sorter.column("pack")}>Package Details</TH>
              <TH sort={sorter.column("uom")}>UOM</TH>
              <TH sort={sorter.column("location")}>Location</TH>
              <TH className="text-right" sort={sorter.column("cost")}>
                Cost
              </TH>
              <TH className="text-right" sort={sorter.column("wholesale")}>
                Wholesale
              </TH>
              <TH className="text-right" sort={sorter.column("retail")}>
                Retail
              </TH>
              <TH className="text-right" sort={sorter.column("stock")}>
                In Stock
              </TH>
              <TH className="w-24">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={10}>No items found.</EmptyRow>}
            {pager.pageRows.map((item, i) => (
              <Fragment key={item.id}>
                {/* A category heading where it starts, and on top of each page */}
                {!sorter.active && (i === 0 || categoryOf(item) !== categoryOf(pager.pageRows[i - 1])) && (
                  <GroupRow colSpan={10}>
                    {categoryOf(item)} <span className="font-normal text-slate-500 normal-case">· {perCategory.get(categoryOf(item))?.length ?? 0} items</span>
                  </GroupRow>
                )}
                <TR>
                  <TD className="font-mono text-xs font-medium text-slate-900">{item.sapCode}</TD>
                  <TD className="font-medium text-slate-900">{item.description}</TD>
                  <TD>{item.packageDetails || "—"}</TD>
                  <TD>{item.uom}</TD>
                  <TD className="whitespace-nowrap">{item.locationNumber || <span className="font-medium text-amber-700">Not set</span>}</TD>
                  <TD className="text-right tabular-nums">
                    {item.costPrice > 0 ? formatMoney(item.costPrice) : <span className="font-medium text-amber-700">Not set</span>}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {formatMoney(item.wholesalePrice)}
                    {item.costPrice > 0 && item.wholesalePrice > 0 && (
                      <span className="block text-xs text-slate-500">
                        {(((item.wholesalePrice - item.costPrice) / item.wholesalePrice) * 100).toFixed(1)}% margin
                      </span>
                    )}
                  </TD>
                  <TD className="text-right tabular-nums">
                    {/* 0 = no retail price (e.g. bulk bags), not a free item */}
                    {item.retailPrice > 0 ? formatMoney(item.retailPrice) : <span className="text-slate-400">—</span>}
                  </TD>
                  <TD className="text-right tabular-nums">{formatQty(availableBySap.get(item.sapCode) ?? 0)}</TD>
                  <TD>
                    <RowActions>
                      <Button variant="ghost" size="icon" onClick={() => form.open(item)} aria-label={`Edit ${item.sapCode}`}>
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="hover:bg-red-50 hover:text-red-600"
                        onClick={() => remove.open(item)}
                        aria-label={`Delete ${item.sapCode}`}
                      >
                        <Trash2 />
                      </Button>
                    </RowActions>
                  </TD>
                </TR>
              </Fragment>
            ))}
          </TBody>
        </Table>
        <TableFooter pager={<Pagination pager={pager} />}>
          {rows.length === items.length ? items.length : `${rows.length} of ${items.length}`} items
        </TableFooter>
      </Card>

      <ItemFormDialog
        open={form.isOpen}
        item={form.target === "new" ? null : form.target}
        onClose={form.close}
      />

      <ConfirmDialog
        open={remove.isOpen}
        onClose={remove.close}
        title="Delete item?"
        message={
          <>
            <span className="font-medium text-slate-900">{remove.target?.sapCode}</span> ({remove.target?.description}) will be
            removed from the Items master.
          </>
        }
        onConfirm={async () => {
          if (!remove.target) return;
          const result = await deleteItem(remove.target.id);
          if (result.ok) toast.success("Item deleted");
          else toast.error(result.error);
          remove.close();
        }}
      />
    </>
  );
}
