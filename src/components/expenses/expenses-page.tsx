"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, Input, ReadOnlyValue, Select, toNumber } from "@/components/ui/form";
import { Card, FilterTabs, PageHeader, SearchInput, TableFooter, Toolbar } from "@/components/ui/layout";
import { Modal } from "@/components/ui/modal";
import { Pagination, usePagination } from "@/components/ui/pagination";
import { EmptyRow, RowActions, Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAppStore } from "@/lib/store";
import { EXPENSE_CATEGORIES, PAYMENT_METHODS, type Expense, type ExpenseCategory, type PaymentMethod } from "@/lib/types";
import { useDialog } from "@/lib/use-dialog";
import { formatDate, formatMoney, includesText, nextCode, todayISO } from "@/lib/utils";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

type Values = { date: string; category: ExpenseCategory; description: string; amount: string; method: PaymentMethod };

function ExpenseForm({ expense, onDone }: { expense: Expense | null; onDone: () => void }) {
  const expenses = useAppStore((s) => s.expenses);
  const addExpense = useAppStore((s) => s.addExpense);
  const updateExpense = useAppStore((s) => s.updateExpense);
  const [values, setValues] = useState<Values>(() => ({
    date: expense?.date ?? todayISO(),
    category: expense?.category ?? "Fuel",
    description: expense?.description ?? "",
    amount: expense ? String(expense.amount) : "",
    method: expense?.method ?? "Cash",
  }));
  const [errors, setErrors] = useState<{ date?: string; amount?: string }>({});
  const set = (key: keyof Values) => (e: { target: { value: string } }) => setValues((v) => ({ ...v, [key]: e.target.value }));

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!values.date) next.date = "Select a date.";
    if (!(toNumber(values.amount) > 0)) next.amount = "Enter an amount above 0.";
    setErrors(next);
    if (Object.keys(next).length) return;
    const input = { ...values, amount: toNumber(values.amount) };
    const result = await (expense ? updateExpense(expense.id, input) : addExpense(input));
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(expense ? "Expense updated" : `Expense of ${formatMoney(input.amount)} added`);
    onDone();
  }

  return (
    <form id="expense-form" onSubmit={handleSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
      <Field label="Expense No.">
        <ReadOnlyValue className="font-medium">{expense?.expenseNo ?? nextCode(expenses.map((x) => x.expenseNo), "EX", 4)}</ReadOnlyValue>
      </Field>
      <Field label="Date" htmlFor="exDate" required error={errors.date}>
        <Input id="exDate" type="date" value={values.date} onChange={set("date")} aria-invalid={!!errors.date} />
      </Field>
      <Field label="Category" htmlFor="exCategory" required>
        <Select id="exCategory" value={values.category} onChange={set("category")}>
          {EXPENSE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Amount (Rs.)" htmlFor="exAmount" required error={errors.amount}>
        <Input
          id="exAmount"
          type="number"
          min={0}
          step="0.01"
          inputMode="decimal"
          value={values.amount}
          onChange={set("amount")}
          aria-invalid={!!errors.amount}
          className="font-semibold tabular-nums"
          autoFocus
        />
      </Field>
      <Field label="Description" htmlFor="exDesc" className="sm:col-span-2">
        <Input id="exDesc" value={values.description} onChange={set("description")} placeholder="e.g. Diesel for WP LB-4521" />
      </Field>
      <Field label="Paid by" className="sm:col-span-2">
        <FilterTabs<PaymentMethod>
          value={values.method}
          onChange={(method) => setValues((v) => ({ ...v, method }))}
          options={PAYMENT_METHODS.map((m) => ({ value: m, label: m }))}
        />
      </Field>
    </form>
  );
}

export function ExpensesPage() {
  const expenses = useAppStore((s) => s.expenses);
  const deleteExpense = useAppStore((s) => s.deleteExpense);
  const [query, setQuery] = useState("");
  const [month, setMonth] = useState(() => todayISO().slice(0, 7));
  const [category, setCategory] = useState("");
  const form = useDialog<Expense | "new">();
  const remove = useDialog<Expense>();

  const months = useMemo(() => {
    const set = new Set(expenses.map((e) => e.date.slice(0, 7)));
    set.add(todayISO().slice(0, 7));
    return [...set].sort().reverse();
  }, [expenses]);

  const rows = expenses
    .filter((e) => !month || e.date.startsWith(month))
    .filter((e) => !category || e.category === category)
    .filter((e) => includesText([e.expenseNo, e.category, e.description], query))
    .sort((a, b) => b.date.localeCompare(a.date) || b.expenseNo.localeCompare(a.expenseNo));
  const total = rows.reduce((sum, e) => sum + e.amount, 0);
  const editing = form.target === "new" ? null : form.target;

  const pager = usePagination(rows, [query, month, category]);

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Running costs (fuel, lorry repairs, labour, phone…). They are taken off gross profit to get net profit."
        actions={
          <Button onClick={() => form.open("new")}>
            <Plus /> Add expense
          </Button>
        }
      />

      <Card>
        <Toolbar>
          <SearchInput placeholder="Search description or category" value={query} onChange={(e) => setQuery(e.target.value)} />
          <Select value={month} onChange={(e) => setMonth(e.target.value)} className="h-9 sm:w-40" aria-label="Filter by month">
            <option value="">All months</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m)}
              </option>
            ))}
          </Select>
          <Select value={category} onChange={(e) => setCategory(e.target.value)} className="h-9 sm:w-48" aria-label="Filter by category">
            <option value="">All categories</option>
            {EXPENSE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Toolbar>
        <Table>
          <THead>
            <tr>
              <TH>Expense No.</TH>
              <TH>Date</TH>
              <TH>Category</TH>
              <TH>Description</TH>
              <TH>Paid by</TH>
              <TH className="text-right">Amount</TH>
              <TH className="w-24">
                <span className="sr-only">Actions</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {rows.length === 0 && <EmptyRow colSpan={7}>No expenses{month ? ` in ${monthLabel(month)}` : ""}.</EmptyRow>}
            {pager.pageRows.map((e) => (
              <TR key={e.id}>
                <TD className="font-semibold text-slate-900">{e.expenseNo}</TD>
                <TD className="tabular-nums">{formatDate(e.date)}</TD>
                <TD>{e.category}</TD>
                <TD className="min-w-48 whitespace-normal text-slate-600">{e.description || "—"}</TD>
                <TD>{e.method}</TD>
                <TD className="text-right font-semibold text-slate-900 tabular-nums">{formatMoney(e.amount)}</TD>
                <TD>
                  <RowActions>
                    <Button variant="ghost" size="icon" onClick={() => form.open(e)} aria-label={`Edit ${e.expenseNo}`} title="Edit">
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hover:bg-red-50 hover:text-red-600"
                      onClick={() => remove.open(e)}
                      aria-label={`Delete ${e.expenseNo}`}
                      title="Delete"
                    >
                      <Trash2 />
                    </Button>
                  </RowActions>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
        <TableFooter pager={<Pagination pager={pager} />}>
          {rows.length} expenses · <span className="font-medium text-slate-700">{formatMoney(total)}</span> total
        </TableFooter>
      </Card>

      <Modal
        open={form.isOpen}
        onClose={form.close}
        title={editing ? `Edit ${editing.expenseNo}` : "Add expense"}
        footer={
          <>
            <Button variant="outline" onClick={form.close}>
              Cancel
            </Button>
            <Button type="submit" form="expense-form">
              {editing ? "Save changes" : "Add expense"}
            </Button>
          </>
        }
      >
        <ExpenseForm key={editing?.id ?? "new"} expense={editing} onDone={form.close} />
      </Modal>
      <ConfirmDialog
        open={remove.isOpen}
        onClose={remove.close}
        title={`Delete ${remove.target?.expenseNo}?`}
        message={`${remove.target?.category} · ${formatMoney(remove.target?.amount ?? 0)} on ${formatDate(remove.target?.date ?? "")}`}
        onConfirm={async () => {
          if (!remove.target) return;
          const result = await deleteExpense(remove.target.id);
          if (result.ok) toast.success("Expense deleted");
          else toast.error(result.error);
          remove.close();
        }}
      />
    </>
  );
}
