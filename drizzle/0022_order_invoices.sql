CREATE TABLE "order_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "order_invoices_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" text NOT NULL,
	"invoice_number" text DEFAULT '' NOT NULL,
	"po_number" text DEFAULT '' NOT NULL,
	"company" text DEFAULT '' NOT NULL,
	"invoice_date" date,
	"discount_percent" numeric(5, 2) DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "invoice_id" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "invoiced_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "order_invoices" ADD CONSTRAINT "order_invoices_order_id_orders_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("order_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_invoice_id_order_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."order_invoices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
-- Each order's one invoice (number, PO, discount %) moves to order_invoices; its received items are on it
INSERT INTO "order_invoices" ("id", "order_id", "invoice_number", "po_number", "company", "invoice_date", "discount_percent")
  SELECT 'inv-' || "id", "order_id", "invoice_number", "po_number", '', "received_date", "discount_percent" FROM "orders"
  WHERE "received_date" IS NOT NULL OR "invoice_number" <> '' OR "po_number" <> '' OR "discount_percent" <> 0
  ORDER BY "seq";--> statement-breakpoint
UPDATE "order_items" SET "invoice_id" = 'inv-' || "orders"."id", "invoiced_qty" = "order_items"."received_qty"
  FROM "orders" WHERE "orders"."order_id" = "order_items"."order_id" AND "orders"."received_date" IS NOT NULL AND "order_items"."received_qty" > 0;--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "invoice_number";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "po_number";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "discount_percent";--> statement-breakpoint
CREATE POLICY "no_api_access" ON "order_invoices" AS PERMISSIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);