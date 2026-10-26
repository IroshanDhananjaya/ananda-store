ALTER TABLE "sale_lines" ADD COLUMN "note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD COLUMN "free_with" text DEFAULT '' NOT NULL;