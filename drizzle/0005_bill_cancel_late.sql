ALTER TABLE "sales" DROP CONSTRAINT "sales_status";--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "late" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_status" CHECK ("sales"."status" in ('Ordered', 'Loaded', 'Delivered', 'Cancelled'));