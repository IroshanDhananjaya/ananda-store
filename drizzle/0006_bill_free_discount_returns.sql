ALTER TABLE "sale_lines" DROP CONSTRAINT "sale_lines_saleId_sapCode_locationNumber_unique";--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "kind" text DEFAULT 'Sale' NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "free_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "discount_pct" numeric(5, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "cancel_qty" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "discount_percent" numeric(5, 2) DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_saleId_kind_sapCode_locationNumber_unique" UNIQUE("sale_id","kind","sap_code","location_number");