ALTER TABLE "order_invoices" ADD COLUMN "payment_method" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_invoices" ADD COLUMN "paid_date" date;--> statement-breakpoint
ALTER TABLE "order_invoices" ADD COLUMN "cheque_number" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_invoices" ADD COLUMN "cheque_deposit_date" date;--> statement-breakpoint
ALTER TABLE "order_invoices" ADD COLUMN "payment_reference" text DEFAULT '' NOT NULL;