"use client";

import { PackageMinus, Pencil, Plus, Trash2 } from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/form";
import { Card, ClearFilters, FilterTabs, PageHeader, SearchInput, SummaryTile, TableFooter, Toolbar } from "@/components/ui/layout";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, GroupRow, RowActions, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { categoryOf, compareByCategory } from "@/lib/categories";
import { useAppStore, useCategoryRanks, useItemMap } from "@/lib/store";
import type { Item, StockRecord } from "@/lib/types";
import { useDialog } from "@/lib/use-dialog";
import { cn, formatDate, formatMoney, formatQty, includesText, LOW_STOCK_LEVEL, round2 } from "@/lib/utils";
import { ItemFormDialog } from "@/components/items/item-form-dialog";
import { IssueStockDialog, StockFormDialog } from "./stock-dialogs";

type LevelFilter = "all" | "low" | "noCost";

/** In the store but no cost price on the item, so it adds nothing to the stock value */
const missingCost = (r: StockRecord, item?: Item) => r.availableQty > 0 && !item?.costPrice;

export function StockPage() {
  const stock = useAppStore((s) => s.stock);
  const locations = useAppStore((s) => s.locations);
  const deleteStock = useAppStore((s) => s.deleteStock);
  const itemMap = useItemMap();
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [level, setLevel] = useState<LevelFilter>("all");
  const [category, setCategory] = useState("");
  const ranks = useCategoryRanks();
  const categoryOfRow = (r: StockRecord) => categoryOf(itemMap.get(r.sapCode));
  const form = useDialog<StockRecord | "new">();
  const issue = useDialog<StockRecord>();
  const remove = useDialog<StockRecord>();
  const editItem = useDialog<Item>();

  const lowCount = stock.filter((r) => r.availableQty <= LOW_STOCK_LEVEL).length;
  const noCostCount = stock.filter((r) => missingCost(r, itemMap.get(r.sapCode))).length;
  const rows = stock
    .filter((r) => !location || r.locationNumber === location)
    .filter((r) => level === "all" || (level === "low" ? r.availableQty <= LOW_STOCK_LEVEL : missingCost(r, itemMap.get(r.sapCode))))
    .filter((r) => !category || categoryOfRow(r) === category)
    .filter((r) => {
      const item = itemMap.get(r.sapCode);
      return includesText([r.sapCode, item?.description, item?.packageDetails, r.locationNumber, categoryOf(item)], query);
    })
    // Under their item categories (sheet order), then by location
    .sort(
      (a, b) =>
        compareByCategory(ranks, itemMap.get(a.sapCode), itemMap.get(b.sapCode)) ||
        a.sapCode.localeCompare(b.sapCode) ||
        a.locationNumber.localeCompare(b.locationNumber),
    );
  const perCategory = Map.groupBy(rows, categoryOfRow);

  const totalAvailable = rows.reduce((sum, r) => sum + r.availableQty, 0);
  const totalIssued = rows.reduce((sum, r) => sum + r.issuedQty, 0);
  // Stock value at cost (what Raigam is paid) and at wholesale (what it sells for)
  const costValue = (r: StockRecord) => round2(r.availableQty * (itemMap.get(r.sapCode)?.costPrice ?? 0));
  const totalCost = round2(rows.reduce((sum, r) => sum + costValue(r), 0));
  const totalWholesale = round2(rows.reduce((sum, r) => sum + r.availableQty * (itemMap.get(r.sapCode)?.wholesalePrice ?? 0), 0));
  const itemsInView = new Set(rows.map((r) => r.sapCode)).size;
  const locationsInView = new Set(rows.map((r) => r.locationNumber)).size;
  const outOfStock = rows.filter((r) => r.availableQty <= 0).length;
  const lowInView = rows.filter((r) => r.availableQty > 0 && r.availableQty <= LOW_STOCK_LEVEL);
  const noCost = rows.filter((r) => missingCost(r, itemMap.get(r.sapCode))).length;
  const filtered = !!(query || location || category || level !== "all");

  const pager = usePagination(rows, [query, location, level, category]);

  return (
    <>
      <PageHeader
        title="Stock"
        description="Warehouse stock per item and location (your “Store Details” sheet). Posting an order adds stock; sales and issues take it out."
        actions={
          <Button onClick={() => form.open("new")}>
            <Plus /> Add stock record
          </Button>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile
          label="Stock value"
          value={formatMoney(totalCost)}
          sub={
            <>
              At cost · {formatMoney(totalWholesale)} at wholesale
              {noCost > 0 && (
                <>
                  {" · "}
                  <button type="button" onClick={() => setLevel("noCost")} className="font-medium text-red-600 hover:underline">
                    {noCost} with no cost price
                  </button>
                </>
              )}
            </>
          }
        />
        <SummaryTile
          label="Units in stock"
          value={formatQty(totalAvailable)}
          sub={`${formatQty(itemsInView)} item${itemsInView === 1 ? "" : "s"} · ${formatQty(locationsInView)} location${locationsInView === 1 ? "" : "s"}${filtered ? " · in this view" : ""}`}
        />
        <SummaryTile
          label="Low stock"
          value={formatQty(lowInView.length)}
          tone={lowInView.length ? "danger" : "default"}
          sub={`1 to ${LOW_STOCK_LEVEL} left · ${formatMoney(round2(lowInView.reduce((sum, r) => sum + costValue(r), 0)))} at cost`}
        />
        <SummaryTile
          label="Out of stock"
          value={formatQty(outOfStock)}
          tone={outOfStock ? "danger" : "default"}
          sub={`${formatQty(totalIssued)} units issued in total`}
        />
      </div>

      <Card>
        <Toolbar>
          <SearchInput placeholder="Search SAP code or description" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Select
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className={cn("h-9 sm:w-52", location && "border-brand-500 bg-brand-50 font-medium text-brand-800")}
            aria-label="Filter by location"
          >
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.locationNumber}>
                {l.locationNumber} · {l.itemGroup}
              </option>
            ))}
          </Select>
          <Select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={cn("h-9 sm:w-52", category && "border-brand-500 bg-brand-50 font-medium text-brand-800")}
            aria-label="Filter by category"
          >
            <option value="">All categories</option>
            {[...ranks.keys()].map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
          <ClearFilters
            active={!!(query || location || category || level !== "all")}
            onClear={() => {
              setQuery("");
              setLocation("");
              setCategory("");
              setLevel("all");
            }}
          />
          <div className="sm:ml-auto">
            <FilterTabs<LevelFilter>
              value={level}
              onChange={setLevel}
              options={[
                { value: "all", label: "All", count: stock.length },
                { value: "low", label: "Low stock", count: lowCount },
                { value: "noCost", label: "No cost price", count: noCostCount },
              ]}
            />
          </div>
        </Toolbar>
        <Table>
          <THead>
            <tr>
              <TH>SAP Code</TH>
              <TH>Item Description</TH>
              <TH>Package Type</TH>
              <TH>Store Location</TH>
              <TH className="text-right">Available QTY</TH>
              <TH className="text-right">Issued</TH>
              <TH className="text-right" title="What Raigam is paid per unit">
                Cost Price
              </TH>
              <TH className="text-right" title="Available qty × cost price">
                Stock Value
              </TH>
              <TH>Last Update</TH>
              <TH className="w-32">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={10}>{level === "noCost" ? "Every item in the store has a cost price." : "No stock records found."}</EmptyRow>}
            {pager.pageRows.map((r, i) => {
              const item = itemMap.get(r.sapCode);
              const low = r.availableQty <= LOW_STOCK_LEVEL;
              return (
                <Fragment key={r.id}>
                  {/* A category heading where it starts, and on top of each page */}
                  {(i === 0 || categoryOfRow(r) !== categoryOfRow(pager.pageRows[i - 1])) && (
                    <GroupRow colSpan={10}>
                      {categoryOfRow(r)} <span className="font-normal text-slate-500 normal-case">· {perCategory.get(categoryOfRow(r))?.length ?? 0} records</span>
                    </GroupRow>
                  )}
                  <TR>
                    <TD className="font-mono text-xs font-medium text-slate-900">{r.sapCode}</TD>
                    <TD className="font-medium text-slate-900">{item?.description ?? "Unknown item"}</TD>
                    <TD>{item?.packageDetails || "—"}</TD>
                    <TD>
                      <Badge tone="slate">{r.locationNumber}</Badge>
                    </TD>
                    <TD className="text-right">
                      <span className={cn("tabular-nums font-semibold", low ? "text-amber-700" : "text-slate-900")}>
                        {formatQty(r.availableQty)}
                      </span>
                      {low && (
                        <Badge tone="amber" className="ml-2">
                          Low
                        </Badge>
                      )}
                    </TD>
                    <TD className="text-right tabular-nums">{formatQty(r.issuedQty)}</TD>
                    <TD className="text-right tabular-nums">
                      {item?.costPrice ? (
                        formatMoney(item.costPrice)
                      ) : item && missingCost(r, item) ? (
                        <button
                          type="button"
                          onClick={() => editItem.open(item)}
                          title="No cost price, so this stock isn't in the stock value. Set it on the item."
                          className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700 ring-1 ring-red-200 hover:bg-red-100"
                        >
                          No cost · Set
                        </button>
                      ) : (
                        "—"
                      )}
                    </TD>
                    <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatMoney(costValue(r))}</TD>
                    <TD className="tabular-nums">{formatDate(r.lastUpdate)}</TD>
                    <TD>
                      <RowActions>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => issue.open(r)}
                          disabled={r.availableQty === 0}
                          title="Issue stock"
                          aria-label={`Issue ${r.sapCode}`}
                        >
                          <PackageMinus />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => form.open(r)} title="Edit" aria-label={`Edit ${r.sapCode}`}>
                          <Pencil />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="hover:bg-red-50 hover:text-red-600"
                          onClick={() => remove.open(r)}
                          title="Delete"
                          aria-label={`Delete ${r.sapCode}`}
                        >
                          <Trash2 />
                        </Button>
                      </RowActions>
                    </TD>
                  </TR>
                </Fragment>
              );
            })}
          </TBody>
        </Table>
        <TableFooter pager={<Pagination pager={pager} />}>
          {rows.length} records · {formatQty(totalAvailable)} available · {formatQty(totalIssued)} issued ·{" "}
          <span className="font-semibold text-slate-900">{formatMoney(totalCost)}</span> stock value
        </TableFooter>
      </Card>

      <StockFormDialog open={form.isOpen} record={form.target === "new" ? null : form.target} onClose={form.close} />
      <IssueStockDialog open={issue.isOpen} record={issue.target} onClose={issue.close} />
      <ItemFormDialog open={editItem.isOpen} item={editItem.target} onClose={editItem.close} />
      <ConfirmDialog
        open={remove.isOpen}
        onClose={remove.close}
        title="Delete stock record?"
        message={
          <>
            The stock record for <span className="font-medium text-slate-900">{remove.target?.sapCode}</span> at{" "}
            {remove.target?.locationNumber} ({formatQty(remove.target?.availableQty ?? 0)} available) will be removed.
          </>
        }
        onConfirm={async () => {
          if (!remove.target) return;
          const result = await deleteStock(remove.target.id);
          if (result.ok) toast.success("Stock record deleted");
          else toast.error(result.error);
          remove.close();
        }}
      />
    </>
  );
}
