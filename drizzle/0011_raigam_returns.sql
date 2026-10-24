CREATE TABLE "raigam_return_lines" (
	"return_id" text NOT NULL,
	"position" integer NOT NULL,
	"kind" text NOT NULL,
	"sap_code" text NOT NULL,
	"qty" integer NOT NULL,
	CONSTRAINT "raigam_return_lines_return_id_position_pk" PRIMARY KEY("return_id","position"),
	CONSTRAINT "raigam_return_lines_qty" CHECK ("raigam_return_lines"."qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "raigam_return_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "raigam_returns" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "raigam_returns_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"return_no" text NOT NULL,
	"date" date NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	CONSTRAINT "raigam_returns_returnNo_unique" UNIQUE("return_no")
);
--> statement-breakpoint
ALTER TABLE "raigam_returns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "raigam_return_lines" ADD CONSTRAINT "raigam_return_lines_return_id_raigam_returns_id_fk" FOREIGN KEY ("return_id") REFERENCES "public"."raigam_returns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raigam_return_lines" ADD CONSTRAINT "raigam_return_lines_sap_code_items_sap_code_fk" FOREIGN KEY ("sap_code") REFERENCES "public"."items"("sap_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "no_api_access" ON "raigam_return_lines" AS PERMISSIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "no_api_access" ON "raigam_returns" AS PERMISSIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);