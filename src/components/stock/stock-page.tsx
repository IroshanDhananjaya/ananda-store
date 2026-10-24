"use client";

import { PackageMinus, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Select } from "@/components/ui/form";
import { Card, FilterTabs, PageHeader, SearchInput, TableFooter, Toolbar } from "@/components/ui/layout";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, RowActions, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAppStore, useItemMap } from "@/lib/store";
import type { StockRecord } from "@/lib/types";
import { useDialog } from "@/lib/use-dialog";
import { cn, formatDate, formatQty, includesText, LOW_STOCK_LEVEL } from "@/lib/utils";
import { IssueStockDialog, StockFormDialog } from "./stock-dialogs";

type LevelFilter = "all" | "low";

export function StockPage() {
  const stock = useAppStore((s) => s.stock);
  const locations = useAppStore((s) => s.locations);
  const deleteStock = useAppStore((s) => s.deleteStock);
  const itemMap = useItemMap();
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [level, setLevel] = useState<LevelFilter>("all");
  const form = useDialog<StockRecord | "new">();
  const issue = useDialog<StockRecord>();
  const remove = useDialog<StockRecord>();

  const lowCount = stock.filter((r) => r.availableQty <= LOW_STOCK_LEVEL).length;
  const rows = stock
    .filter((r) => !location || r.locationNumber === location)
    .filter((r) => level === "all" || r.availableQty <= LOW_STOCK_LEVEL)
    .filter((r) => {
      const item = itemMap.get(r.sapCode);
      return includesText([r.sapCode, item?.description, item?.packageDetails, r.locationNumber], query);
    })
    .sort((a, b) => a.locationNumber.localeCompare(b.locationNumber) || a.sapCode.localeCompare(b.sapCode));

  const totalAvailable = rows.reduce((sum, r) => sum + r.availableQty, 0);
  const totalIssued = rows.reduce((sum, r) => sum + r.issuedQty, 0);

  const pager = usePagination(rows, [query, location, level]);

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

      <Card>
        <Toolbar>
          <SearchInput placeholder="Search SAP code or description" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Select value={location} onChange={(e) => setLocation(e.target.value)} className="h-9 sm:w-52" aria-label="Filter by location">
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.locationNumber}>
                {l.locationNumber} · {l.itemGroup}
              </option>
            ))}
          </Select>
          <div className="sm:ml-auto">
            <FilterTabs<LevelFilter>
              value={level}
              onChange={setLevel}
              options={[
                { value: "all", label: "All", count: stock.length },
                { value: "low", label: "Low stock", count: lowCount },
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
              <TH>Last Update</TH>
              <TH className="w-32">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={8}>No stock records found.</EmptyRow>}
            {pager.pageRows.map((r) => {
              const item = itemMap.get(r.sapCode);
              const low = r.availableQty <= LOW_STOCK_LEVEL;
              return (
                <TR key={r.id}>
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
              );
            })}
          </TBody>
        </Table>
        <TableFooter pager={<Pagination pager={pager} />}>
          {rows.length} records · {formatQty(totalAvailable)} available · {formatQty(totalIssued)} issued
        </TableFooter>
      </Card>

      <StockFormDialog open={form.isOpen} record={form.target === "new" ? null : form.target} onClose={form.close} />
      <IssueStockDialog open={issue.isOpen} record={issue.target} onClose={issue.close} />
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
