ALTER TABLE "orders" ADD COLUMN "payment_method" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "paid_date" date;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_reference" text DEFAULT '' NOT NULL;