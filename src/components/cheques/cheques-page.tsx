"use client";

import { CircleCheck, Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChequeStatusBadge } from "@/components/payments/cheque-status-field";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/form";
import { Card, CardHeader, DateRangeInputs, FilterTabs, inDateRange, PageHeader, SearchInput, SummaryTile, TableFooter, Toolbar, type DateRange } from "@/components/ui/layout";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { isPaid } from "@/lib/ledger";
import { useAppStore, useRouteMap, useSaleDues, useShopMap } from "@/lib/store";
import { OPENING_BILL, type Payment, type Sale } from "@/lib/types";
import { cn, daysUntil, formatDate, formatMoney, formatQty, includesText, round2, todayISO } from "@/lib/utils";

/** Credit and cheques are given for up to 21 days; these are flagged this many days before their date */
const DUE_SOON_DAYS = 5;

/** Which date the range is for: when the credit / cheque was given, its end / cheque date, or when it was collected */
type DateBy = "given" | "end" | "collected";
type CreditFilter = "soon" | "overdue" | "open" | "collected" | "all";
type ChequeFilter = "soon" | "toCollect" | "collected" | "all";

/** A delivered bill that went on credit (not fully paid on its delivery day), or a store's opening balance */
type CreditBill = {
  key: string;
  /** The bill; none for a store's opening balance (owed before using the app) */
  sale?: Sale;
  shopId: string;
  /** Delivered date; "" for an opening balance */
  date: string;
  /** End date for collecting; "" for an opening balance (no end date) */
  dueDate: string;
  /** Left on credit at delivery, incl. any credit amount added (opening balance: the amount owed) */
  credit: number;
  /** Paid since delivery */
  collected: number;
  /** Still to collect */
  due: number;
  /** Days to its end date (negative = overdue); Infinity without an end date */
  daysLeft: number;
  /** When it was fully collected; "" = still to collect */
  collectedDate: string;
};

const plural = (n: number, word: string) => `${formatQty(n)} ${word}${n === 1 ? "" : "s"}`;
const sumOf = (list: Payment[]) => round2(list.reduce((sum, p) => sum + p.amount, 0));
const dueOf = (list: CreditBill[]) => round2(list.reduce((sum, b) => sum + b.due, 0));
const isCheque = (p: Payment) => p.method === "Cheque";
const toCollect = (p: Payment) => isCheque(p) && !p.chequeCollectedDate;

const isOpen = (b: CreditBill) => b.due > 0.004;
const isOverdue = (b: CreditBill) => isOpen(b) && b.daysLeft < 0;
const isDueSoon = (b: CreditBill) => isOpen(b) && b.daysLeft >= 0 && b.daysLeft <= DUE_SOON_DAYS;
/**
 * Its cheque date is within the next few days: time to bank it (in hand), or to collect it from the store
 * (still to collect, also once its date has passed)
 */
const isChequeSoon = (p: Payment) => {
  if (!p.chequeDate) return toCollect(p);
  const days = daysUntil(p.chequeDate);
  return days <= DUE_SOON_DAYS && (toCollect(p) || days >= 0);
};
/** In hand and its date hasn't passed: still to be banked */
const inHand = (p: Payment) => isCheque(p) && !toCollect(p) && (!p.chequeDate || daysUntil(p.chequeDate) >= 0);

const creditDate = (b: CreditBill, by: DateBy) => (by === "given" ? b.date : by === "end" ? b.dueDate : b.collectedDate);
const chequeDate = (p: Payment, by: DateBy) => (by === "given" ? p.date : by === "end" ? p.chequeDate : p.chequeCollectedDate);

const DATE_BY_LABELS: Record<DateBy, string> = {
  given: "Delivered / cheque received",
  end: "End date / cheque date",
  collected: "Collected date",
};

/** Credit bills and cheques from stores, flagged before their date — and the records once collected */
export function ChequesPage() {
  const shops = useAppStore((s) => s.shops);
  const sales = useAppStore((s) => s.sales);
  const payments = useAppStore((s) => s.payments);
  const dues = useSaleDues();
  const [range, setRange] = useState<DateRange>({ from: "", to: "" });
  const [dateBy, setDateBy] = useState<DateBy>("given");

  const creditBills = useMemo(() => {
    const bills = sales
      .filter((s) => s.status === "Delivered")
      .flatMap((sale): CreditBill[] => {
        const d = dues.get(sale.id);
        if (!d) return [];
        // Cheques still to collect aren't paid yet
        const paid = d.payments.filter((p) => !p.pending);
        const atDelivery = round2(paid.filter((p) => p.date <= sale.deliveredDate).reduce((sum, p) => sum + p.amount, 0));
        const credit = round2(d.total + d.extraCredit - atDelivery);
        if (credit <= 0.004) return [];
        const due = Math.max(0, d.due);
        return [
          {
            key: sale.id,
            sale,
            shopId: sale.shopId,
            date: sale.deliveredDate,
            dueDate: sale.dueDate,
            credit,
            collected: round2(d.paid - atDelivery),
            due,
            daysLeft: daysUntil(sale.dueDate),
            collectedDate: due > 0.004 ? "" : (paid.at(-1)?.date ?? sale.deliveredDate),
          },
        ];
      });
    // Opening balances: what a store owed before using the app, paid like a bill
    const old = shops
      .filter((shop) => shop.openingBalance > 0.004)
      .map((shop): CreditBill => {
        const paid = payments
          .filter((p) => p.shopId === shop.id && isPaid(p))
          .flatMap((p) => p.allocations.filter((a) => a.saleId === OPENING_BILL).map((a) => ({ date: p.date, amount: a.amount })))
          .sort((a, b) => a.date.localeCompare(b.date));
        const collected = round2(paid.reduce((sum, p) => sum + p.amount, 0));
        const due = Math.max(0, round2(shop.openingBalance - collected));
        return {
          key: `old-${shop.id}`,
          shopId: shop.id,
          date: "",
          dueDate: "",
          credit: shop.openingBalance,
          collected,
          due,
          daysLeft: Infinity,
          collectedDate: due > 0.004 ? "" : (paid.at(-1)?.date ?? ""),
        };
      });
    return [...old, ...bills];
  }, [shops, sales, payments, dues]);

  const credits = creditBills.filter((b) => inDateRange(creditDate(b, dateBy), range));
  const cheques = payments.filter(isCheque).filter((p) => inDateRange(chequeDate(p, dateBy), range));
  const open = credits.filter(isOpen);
  const soon = credits.filter(isDueSoon);
  const overdue = credits.filter(isOverdue);
  const waiting = cheques.filter(toCollect);
  const chequesSoon = cheques.filter(isChequeSoon);
  const held = cheques.filter(inHand);

  return (
    <>
      <PageHeader
        title="Cheques & Credit"
        description={`Bills on credit and cheques from stores (up to 21 days after delivery), flagged ${DUE_SOON_DAYS} days before their date, and the records once collected.`}
      />
      <Card>
        <Toolbar>
          <DateRangeInputs value={range} onChange={setRange} />
          <Select value={dateBy} onChange={(e) => setDateBy(e.target.value as DateBy)} className="h-9 sm:w-60" aria-label="Which date the range is for">
            {(Object.keys(DATE_BY_LABELS) as DateBy[]).map((k) => (
              <option key={k} value={k}>
                Dates: {DATE_BY_LABELS[k].toLowerCase()}
              </option>
            ))}
          </Select>
          <span className="text-xs text-slate-500 sm:ml-auto">{range.from || range.to ? "Totals and lists below are for these dates." : "All dates."}</span>
        </Toolbar>
      </Card>

      <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryTile label="Credit to collect" value={formatMoney(dueOf(open))} sub={plural(open.length, "bill")} />
        <SummaryTile
          label={`Due in ${DUE_SOON_DAYS} days`}
          value={formatMoney(round2(dueOf(soon) + sumOf(chequesSoon)))}
          sub={soon.length || chequesSoon.length ? `${plural(soon.length, "bill")} · ${plural(chequesSoon.length, "cheque")}` : "Nothing due soon"}
          tone={soon.length || chequesSoon.length ? "danger" : "default"}
        />
        <SummaryTile label="Overdue" value={formatMoney(dueOf(overdue))} sub={`${plural(overdue.length, "bill")} past the end date`} tone={overdue.length ? "danger" : "default"} />
        <SummaryTile
          label="Cheques in hand"
          value={formatMoney(sumOf(held))}
          sub={`${plural(held.length, "cheque")} to bank${waiting.length ? ` · ${waiting.length} still to collect (${formatMoney(sumOf(waiting))})` : ""}`}
        />
      </div>

      <CreditBills bills={credits} />
      <Cheques cheques={cheques} />
    </>
  );
}

function CreditBills({ bills }: { bills: CreditBill[] }) {
  const router = useRouter();
  const routes = useAppStore((s) => s.routes);
  const shopMap = useShopMap();
  const routeMap = useRouteMap();
  const [filter, setFilter] = useState<CreditFilter>("open");
  const [routeId, setRouteId] = useState("");
  const [query, setQuery] = useState("");

  const tests: Record<CreditFilter, (b: CreditBill) => boolean> = { soon: isDueSoon, overdue: isOverdue, open: isOpen, collected: (b) => !isOpen(b), all: () => true };
  const rows = bills
    .filter(tests[filter])
    .filter((b) => !routeId || shopMap.get(b.shopId)?.routeId === routeId)
    .filter((b) => {
      const shop = shopMap.get(b.shopId);
      return includesText([b.sale?.saleNo ?? "Opening balance", b.sale?.invoiceNo, b.sale?.deliveryNote, shop?.shopName, shop?.shopCode, shop?.ownerName], query);
    })
    // To collect: opening balances, then soonest end date first; collected: newest first
    .sort(
      (a, b) =>
        Number(!isOpen(a)) - Number(!isOpen(b)) || (isOpen(a) ? a.dueDate.localeCompare(b.dueDate) : b.collectedDate.localeCompare(a.collectedDate)),
    );
  const pager = usePagination(rows, [filter, routeId, query, bills.length]);

  return (
    <Card className="mt-6">
      <CardHeader
        title="Credit bills"
        description="Delivered bills not fully paid on their delivery day, and stores' opening balances. Click one to open it and record a payment."
      />
      <Toolbar>
        <SearchInput placeholder="Search bill, invoice, store or note" value={query} onChange={(e) => setQuery(e.target.value)} />
        <Select value={routeId} onChange={(e) => setRouteId(e.target.value)} className="h-9 sm:w-52" aria-label="Filter by route">
          <option value="">All routes</option>
          {routes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.routeCode} · {r.routeName}
            </option>
          ))}
        </Select>
        <div className="sm:ml-auto">
          <FilterTabs<CreditFilter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "soon", label: `Due in ${DUE_SOON_DAYS} days`, count: bills.filter(isDueSoon).length },
              { value: "overdue", label: "Overdue", count: bills.filter(isOverdue).length },
              { value: "open", label: "To collect", count: bills.filter(isOpen).length },
              { value: "collected", label: "Collected", count: bills.filter((b) => !isOpen(b)).length },
              { value: "all", label: "All", count: bills.length },
            ]}
          />
        </div>
      </Toolbar>
      <Table>
        <THead>
          <tr>
            <TH>Bill</TH>
            <TH>Store</TH>
            <TH>Delivered</TH>
            <TH>End Date</TH>
            <TH className="text-right">Credit</TH>
            <TH className="text-right">Collected</TH>
            <TH className="text-right">Balance</TH>
            <TH>Status</TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={8}>No credit bills here.</EmptyRow>}
          {pager.pageRows.map((b) => {
            const shop = shopMap.get(b.shopId);
            const route = shop ? routeMap.get(shop.routeId) : undefined;
            return (
              <TR
                key={b.key}
                className={cn("cursor-pointer", isOverdue(b) && "bg-red-50/50", isDueSoon(b) && "bg-amber-50/60")}
                // An opening balance is paid from the store's page (Record payment)
                onClick={() => router.push(b.sale ? `/sales/${b.sale.id}` : `/stores/${b.shopId}`)}
              >
                <TD>
                  {b.sale ? (
                    <>
                      <span className="block font-semibold text-brand-700">{b.sale.saleNo}</span>
                      {b.sale.invoiceNo && <span className="block font-mono text-xs text-slate-600">{b.sale.invoiceNo}</span>}
                    </>
                  ) : (
                    <>
                      <span className="block font-semibold text-brand-700">Opening balance</span>
                      <span className="block text-xs text-slate-500">Owed before using the app</span>
                    </>
                  )}
                </TD>
                <TD className="max-w-72 whitespace-normal">
                  <span className="block font-medium text-slate-900">{shop?.shopName ?? "Deleted store"}</span>
                  <span className="block text-xs text-slate-500">
                    {shop?.shopCode}
                    {route ? ` · ${route.routeCode}` : ""}
                    {shop?.phone ? ` · ${shop.phone}` : ""}
                  </span>
                  {b.sale?.deliveryNote && <span className="mt-0.5 block text-xs text-amber-800">“{b.sale.deliveryNote}”</span>}
                </TD>
                <TD className="tabular-nums">{formatDate(b.date)}</TD>
                <TD className="tabular-nums">{formatDate(b.dueDate)}</TD>
                <TD className="text-right tabular-nums">
                  {formatMoney(b.credit)}
                  {!!b.sale?.extraCredit && <span className="block text-xs text-slate-500">incl. {formatMoney(b.sale.extraCredit)} credit added</span>}
                </TD>
                <TD className="text-right text-emerald-700 tabular-nums">{b.collected > 0 ? formatMoney(b.collected) : "—"}</TD>
                <TD className={cn("text-right font-semibold tabular-nums", isOpen(b) ? "text-slate-900" : "text-slate-400")}>{formatMoney(b.due)}</TD>
                <TD>
                  <CreditStatus bill={b} />
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <TableFooter pager={<Pagination pager={pager} />}>
        {plural(rows.length, "bill")} · Credit {formatMoney(round2(rows.reduce((sum, b) => sum + b.credit, 0)))} · Still to collect{" "}
        <span className="font-medium text-slate-700">{formatMoney(dueOf(rows))}</span>
      </TableFooter>
    </Card>
  );
}

function CreditStatus({ bill }: { bill: CreditBill }) {
  if (!isOpen(bill)) return <Badge tone="green">Collected {formatDate(bill.collectedDate)}</Badge>;
  if (!Number.isFinite(bill.daysLeft)) return <Badge tone="slate">To collect</Badge>;
  if (bill.daysLeft < 0) return <Badge tone="red">Overdue {plural(-bill.daysLeft, "day")}</Badge>;
  if (bill.daysLeft <= DUE_SOON_DAYS) return <Badge tone="amber">{bill.daysLeft === 0 ? "Due today" : `Due in ${plural(bill.daysLeft, "day")}`}</Badge>;
  return <Badge tone="slate">{plural(bill.daysLeft, "day")} left</Badge>;
}

function Cheques({ cheques }: { cheques: Payment[] }) {
  const router = useRouter();
  const markChequeCollected = useAppStore((s) => s.markChequeCollected);
  const shopMap = useShopMap();
  const routeMap = useRouteMap();
  const [filter, setFilter] = useState<ChequeFilter>("all");
  const [query, setQuery] = useState("");

  const tests: Record<ChequeFilter, (p: Payment) => boolean> = { soon: isChequeSoon, toCollect, collected: (p) => !toCollect(p), all: () => true };
  const rows = cheques
    .filter(tests[filter])
    .filter((p) => {
      const shop = shopMap.get(p.shopId);
      return includesText([p.chequeNumber, p.receiptNo, p.reference, shop?.shopName, shop?.shopCode], query);
    })
    // Soonest cheque date first (no date last)
    .sort((a, b) => (a.chequeDate || "9999").localeCompare(b.chequeDate || "9999") || a.receiptNo.localeCompare(b.receiptNo));
  const pager = usePagination(rows, [filter, query, cheques.length]);

  async function mark(p: Payment, date: string) {
    const result = await markChequeCollected(p.id, date);
    if (!result.ok) toast.error(result.error);
    else toast.success(date ? `Cheque ${p.chequeNumber} collected from the store · ${formatMoney(p.amount)}` : `Cheque ${p.chequeNumber} is back to collect`);
  }

  return (
    <Card className="mt-6">
      <CardHeader
        title="Cheques"
        description="Cheques from stores, soonest cheque date first: to collect from the store, or collected (in hand) to bank on their date. Collected on another day? Edit the payment on the Payments page."
      />
      <Toolbar>
        <SearchInput placeholder="Search cheque no., receipt, store or note" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="sm:ml-auto">
          <FilterTabs<ChequeFilter>
            value={filter}
            onChange={setFilter}
            options={[
              { value: "soon", label: `Due in ${DUE_SOON_DAYS} days`, count: cheques.filter(isChequeSoon).length },
              { value: "toCollect", label: "To collect", count: cheques.filter(toCollect).length },
              { value: "collected", label: "Collected", count: cheques.filter((p) => !toCollect(p)).length },
              { value: "all", label: "All", count: cheques.length },
            ]}
          />
        </div>
      </Toolbar>
      <Table>
        <THead>
          <tr>
            <TH>Cheque</TH>
            <TH>Store</TH>
            <TH>Cheque Date</TH>
            <TH className="text-right">Amount</TH>
            <TH>Note</TH>
            <TH>Status</TH>
            <TH className="w-40">
              <span className="sr-only">Actions</span>
            </TH>
          </tr>
        </THead>
        <TBody>
          {rows.length === 0 && <EmptyRow colSpan={7}>No cheques here.</EmptyRow>}
          {pager.pageRows.map((p) => {
            const shop = shopMap.get(p.shopId);
            const route = shop ? routeMap.get(shop.routeId) : undefined;
            const days = p.chequeDate ? daysUntil(p.chequeDate) : 0;
            return (
              <TR
                key={p.id}
                className={cn("cursor-pointer", isChequeSoon(p) && "bg-amber-50/60")}
                onClick={() => shop && router.push(`/stores/${shop.id}`)}
              >
                <TD>
                  <span className="block font-semibold text-slate-900 tabular-nums">{p.chequeNumber || "—"}</span>
                  <span className="block text-xs text-slate-500">
                    {p.receiptNo} · received {formatDate(p.date)}
                  </span>
                </TD>
                <TD className="whitespace-normal">
                  <span className="block font-medium text-slate-900">{shop?.shopName ?? "Deleted store"}</span>
                  <span className="block text-xs text-slate-500">
                    {shop?.shopCode}
                    {route ? ` · ${route.routeCode}` : ""}
                    {shop?.phone ? ` · ${shop.phone}` : ""}
                  </span>
                </TD>
                <TD className="tabular-nums">
                  {p.chequeDate ? formatDate(p.chequeDate) : "—"}
                  {p.chequeDate && (
                    <span className={cn("block text-xs", isChequeSoon(p) ? "font-medium text-amber-700" : "text-slate-500")}>
                      {days > 0 ? `In ${plural(days, "day")}` : days === 0 ? "Today" : `${plural(-days, "day")} ago`}
                    </span>
                  )}
                </TD>
                <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatMoney(p.amount)}</TD>
                <TD className="max-w-56 whitespace-normal text-xs text-slate-600">{p.reference || "—"}</TD>
                <TD>
                  <ChequeStatusBadge payment={p} />
                </TD>
                <TD onClick={(e) => e.stopPropagation()}>
                  {toCollect(p) ? (
                    <Button size="sm" variant="secondary" onClick={() => mark(p, todayISO())} title="You got the cheque from the store today">
                      <CircleCheck /> Mark collected
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => mark(p, "")} title="Not collected after all: back to the cheques to collect">
                      <Undo2 /> Undo
                    </Button>
                  )}
                </TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
      <TableFooter pager={<Pagination pager={pager} />}>
        {plural(rows.length, "cheque")} · {formatMoney(sumOf(rows))}
      </TableFooter>
    </Card>
  );
}
