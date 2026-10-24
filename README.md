# Ananda Stores

A web app for running Ananda Stores' distribution business: buying stock from Raigam, keeping it in the warehouse,
and selling it to stores (shops) along delivery routes while tracking what each store owes.
It replaces the Google Sheets tables (Order Details, Order Item Details, Store Details, Items, Store Location).

Data is stored in a **Supabase** (PostgreSQL) database, so everyone using the app sees the same data.
The Supabase free plan is enough; nothing here needs a paid service.

## Set up the database (once)

1. Create a free account at [supabase.com](https://supabase.com) and a **New project**
   (region: *South Asia (Mumbai)* is closest to Sri Lanka). Write down the database password.
2. In the project, click **Connect** and copy the **Transaction pooler** connection string (port 6543).
3. Copy `.env.example` to `.env.local` and paste the string as `DATABASE_URL`, with your password in it.
4. Create the tables and load the sample data:

```bash
pnpm install
pnpm db:migrate   # creates the tables
pnpm db:seed      # optional: loads the sample data
```

## Set up login (once)

The app needs a login (Supabase Auth, free). Each person who uses it gets an email and password; there is
no sign-up page, so only people you add can get in.

1. In Supabase, open **Project Settings → API Keys**. Copy the project URL and the **Publishable key**
   (`sb_publishable_…`; the older *anon* key also works) into `.env.local` as `SUPABASE_URL` and
   `SUPABASE_PUBLISHABLE_KEY`.
2. **Authentication → Users → Add user → Create new user**: enter an email and password and tick
   *Auto Confirm User*. Do this for everyone who uses the app. To change a forgotten password, open the user there.
3. **Authentication → Sign In / Providers**: turn off **Allow new users to sign up**, so no one can make
   their own account.

Everyone who signs in can see and change all the data. **Sign out** is at the bottom of the sidebar; it only
signs out that device.

## Run it

```bash
pnpm dev          # http://localhost:3000
```

Production build: `pnpm build && pnpm start`.

### Free plan: two things to know

- **A project pauses after 7 days with no use.** Daily use keeps it awake. If it pauses, the app shows
  "Couldn't load the store data". Open the Supabase dashboard, restore the project, then press *Try again*.
- **No automatic backups.** Run `pnpm db:backup` regularly (e.g. weekly). It saves everything to
  `backups/raigam-<date>-<time>.json`; keep copies somewhere safe (Google Drive, USB). `pnpm db:restore <file> --yes`
  puts a backup back (it replaces everything in the database).
- **Start fresh:** `pnpm db:clear --yes` deletes all data (it saves a backup first).

### Adding items and loads from a file

For typing up a photo of a Raigam price list or invoice. Both commands only show what would change
until you add `--yes`, and save a backup before saving.

- `pnpm db:import-items <file>`: a JSON list of items (`sapCode`, `description`, `packageDetails`, `uom`,
  `costPrice`, `wholesalePrice`, `retailPrice`). Existing SAP codes are updated.
- `pnpm db:import-load <file>`: a Raigam invoice, saved exactly like **Receive new load** (stock goes up,
  cost prices become the net price per unit). One load, or a list of them:

```json
{
  "invoiceNumber": "INV-RG-12345", "poNumber": "PO-0001234", "deliveryDate": "23/10/2026",
  "invoiceTotal": 6840, "discountPercent": 10.5, "discountTotal": 718.2, "grandTotal": 6121.8,
  "locationNumber": "LOC - 001",
  "lines": [{ "itemCode": "RM-NOR-CUR-90G", "qty": 50, "unitPrice": 72, "discount": 360, "value": 3240 }]
}
```

`discountPercent` is the invoice's *Discount % for Total Invoice* (0 if there is none).
`value`, `invoiceTotal` (*Total (Rs.)*, before that discount), `discountTotal` and `grandTotal` are what the invoice
prints; they're only checked against qty × price − discount and the discount %.
`discount` (Rs. off the line) defaults to 0. A line's `locationNumber` defaults to the load's, else to where the
item is already kept. Items must already be in *Items*, and an invoice number can't be entered twice.

### Demo data

`ALLOW_DEMO_RESET=true` in `.env.local` shows **Reset demo data** in the sidebar, which replaces all data with the
sample data for everyone. Set it to `false` before you start entering real data.

### Login

Signed-out visitors are sent to `/login` (`src/proxy.ts`), and every server action checks the login again
before it reads or saves anything, so the data stays private even if the proxy doesn't run. When the hosting
site asks for environment variables, add `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` as well as `DATABASE_URL`.

## Pages

| Section | Page | What you can do |
| --- | --- | --- |
| | Dashboard | **Priorities** (most urgent first: stock shortages, overdue bills, credit limits, loading, Raigam deliveries), cash balance due, overdue, net profit this month, collected this month, bills to collect, low stock (out / critical / low) |
| Sales | Routes | Route number, name, area, visit days, sales rep, vehicle. Route page lists its stores with balances and overdue amounts |
| Sales | Stores | Store number, name, owner, phone, address/town, map link, route, credit limit, **credit days**, opening balance, active. Store page: bills to collect, bills not delivered yet, full statement |
| Sales | Store Orders | Bills the rep creates → **Load lorry** → **Deliver & collect** → follow up the balance by its end date. Printable |
| Sales | Daily Invoices | Bills by day for a date range (Today / Yesterday / This week / This month / custom), filtered by route and store, by bill or delivered date, with day totals. **Loading list** tab: total qty per item across those bills (booked, loaded, still to load, in stock, value). Printable |
| Sales | Payments | Every collection (at delivery or later): cash / cheque / bank transfer, and **which bills it paid** |
| Accounts | Profit | Monthly and yearly sales, cost of items, gross profit, expenses and **net profit**; chart, month-by-month table, profit by item / route, expenses by category |
| Accounts | Expenses | Fuel, lorry repairs, labour, salaries, rent, phone… (date, category, amount, how paid) |
| Purchasing | Purchase Orders | *Order Details* sheet: orders placed with Raigam: create, receive, post to stock. **Receive new load**: enter a Raigam invoice (invoice no., PO no., delivery date, items with qty, price, discount, value, stock location, and the **Discount % for Total Invoice**) in one step: saved as a received order whose bill amount is the grand total after that discount, stock goes up, item cost prices become the net price per unit after both discounts. The same invoice number can't be entered twice |
| Purchasing | Order Items | *Order Item Details* sheet: all lines, Match / Unmatch filter |
| Warehouse | Stock | *Store Details* sheet: stock per item per location, **Issue** for damages/samples |
| Warehouse | Items | *Items* sheet: SAP code, package, UOM, **cost price** (what you pay Raigam), wholesale/retail price |
| Warehouse | Stock Locations | *Store Location* sheet: racks/areas and item group |

## Store order workflow

| Step | Who / where | Status | Stock | Cash balance |
| --- | --- | --- | --- | --- |
| 1. **Create bill** | Rep: *Store Orders → New bill* (or *New bill* on a store) | To load | unchanged | unchanged |
| 2. **Load lorry** | *Store Orders → Load lorry*: pick a route, tick bills, check the loading sheet, enter the vehicle | On lorry | **reduced** | unchanged |
| 3. **Deliver & collect** | Bill page → *Deliver & collect cash*: enter the money collected and which bills it pays | Paid / Part paid / Unpaid | — | bill total added, collection taken off |
| 4. **Collect the balance** | Bill page / store page → *Record payment* (or *Collect* on a bill) | Paid when fully collected | — | reduced |

- Each bill has an **end date to collect the balance**: the bill date + the store's **credit days**, editable on the bill and
  at delivery. After the end date the bill is **Overdue** (red), on the bill, store, route, Store Orders (*Overdue* filter) and dashboard.
- **Money collected is always a payment receipt (RC-…) linked to bills.** At delivery it fills this bill first, then the store's
  oldest unpaid bills; you can change the split. Anything not for a bill is kept as an advance and can be applied later
  (*Use … advance* on the store page).
- Mistakes: **Unload** (stock goes back), **Undo delivery** (back on the lorry; its payments become an advance),
  edit a bill (stock is adjusted if it was loaded), delete a bill (stock returned if it was loaded).
- A bill can also be delivered without loading first (*Deliver directly*); stock is reduced at delivery.
- Unit price defaults to the item's wholesale price. Stores over their **credit limit** are flagged; the bill form warns (doesn't block).

## Profit

```
sales        = delivered bill totals (after discount), counted in the month of delivery
cost         = quantity × cost price of each item
gross profit = sales − cost
net profit   = gross profit − expenses
```

- Each bill line saves the item's cost price when the bill is saved, so changing a cost price later
  doesn't change past profit.
- Money collected doesn't change profit (it only changes cash balances); a bill counts when it's delivered.
- Items with no cost price are flagged on the Profit page because their profit would look too high.

## Cash balance (what you need to get from a store)

```
cash balance = opening balance + delivered bill totals − payments
```

Bills that are not delivered yet are not owed. Each delivered bill also has its own cash balance
(`total − payments linked to it`), so you can see exactly which bill still has money to collect.

## Purchase order workflow (Raigam)

1. **New order:** enter invoice/cheque details and the items ordered. Total item quantity and a
   calculated bill amount (wholesale × qty) are filled in automatically; the bill amount can be overwritten
   with the real invoice amount.
2. **Receive order:** when the delivery arrives, record the received date/time and count each item.
   Lines where received ≠ ordered are flagged **Unmatch** automatically.
3. **Post to stock:** adds the received quantities to *Available QTY* in Store Details at the chosen
   location (creates the stock row if the item isn't stored there yet). Posted orders are locked.
4. **Reverse posting** takes the quantities back out of stock and unlocks the order (blocked if that stock
   has already been issued).

Status flow: `Pending delivery → Received → Posted to stock`.

## Rules enforced

- SAP codes, location numbers and item/location stock rows are unique.
- SAP code and location number can't be changed after creation (other tables reference them).
- Items used in stock or orders, and locations holding stock, can't be deleted.
- The same item can't appear twice in one order.
- You can't issue, load or deliver more than the available quantity (loading is all-or-nothing).
- Routes with stores, and stores with bills or payments, can't be deleted (mark the store inactive instead).
  Inactive stores can't get new bills. A payment can't pay more than a bill's balance.

## Code layout

```
src/
  app/                    routes (thin server pages that render the components below)
    (app)/                every page with the sidebar (the folder name isn't part of the URL)
    login/                sign-in page
  proxy.ts                sends signed-out visitors to /login and keeps the login cookies fresh
  components/
    routes/  shops/       routes and stores (a store is called "Shop" in code)
    profit/  expenses/    profit report (with chart) and expenses
    sales/  payments/     store orders (bills, load lorry, deliver) and collections
    orders/               order list, form, detail page, receive / post-to-stock dialogs
    order-items/          order items page
    stock/  items/  locations/  dashboard/
    ui/                   buttons, form controls, modal, table, badges
    auth/                 sign-in form
    app-shell.tsx         sidebar layout, loads data from the server, toasts, "Saving…" indicator, sign out
  db/
    schema.ts             Postgres tables (Drizzle)
    repo.ts               load rows into the app's shapes; run an action in a transaction and save what changed
    connect.ts  index.ts  database connection (DATABASE_URL)
  lib/
    types.ts              data model (mirrors the sheets)
    seed.ts               sample data
    core.ts               every action's rules and validation (runs on the server)
    actions.ts            server actions: signIn, signOut, fetchAllData, runAction (each checks the login)
    supabase.ts           Supabase Auth client (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY)
    store.ts              zustand store in the browser: a copy of the data; actions call the server
    ledger.ts             cash balance, per-bill balances, overdue, payment-to-bill links, statements
    profit.ts             monthly / yearly profit, profit by item / route, expenses by category
    utils.ts              formatting, ID generation, status helpers
drizzle/                  SQL migrations (pnpm db:generate after changing schema.ts, then pnpm db:migrate)
scripts/db.ts             pnpm db:migrate / db:seed / db:backup / db:restore
```

### How saving works

Pages read from the browser store (`src/lib/store.ts`). An action such as *Load lorry* calls the `runAction`
server action, which, inside one database transaction, locks out other changes, loads the current data,
runs the same rules as before (`src/lib/core.ts`) and writes back only the rows that changed. So two
people can't load the same stock twice. The action returns `{ ok: true }` or `{ ok: false, error }` plus the changed
tables, which replace the browser's copy. The data is reloaded when you come back to the tab.

### Next.js 16 notes

`cacheComponents` is enabled. Because of it:

- Dynamic routes (`/orders/[id]`) read `params` inside `<Suspense>`.
- Recently visited pages stay mounted (React `<Activity>`), so dialogs reset themselves when hidden
  (`useDialog`) and forms remount with fresh data (`useResetKey`). See `src/lib/use-dialog.ts`.
