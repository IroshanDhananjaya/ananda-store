CREATE TABLE "free_claim_lines" (
	"claim_id" text NOT NULL,
	"position" integer NOT NULL,
	"sale_id" text NOT NULL,
	"sap_code" text NOT NULL,
	"qty" integer NOT NULL,
	"value" numeric(12, 2) NOT NULL,
	CONSTRAINT "free_claim_lines_claim_id_position_pk" PRIMARY KEY("claim_id","position"),
	CONSTRAINT "free_claim_lines_saleId_sapCode_unique" UNIQUE("sale_id","sap_code"),
	CONSTRAINT "free_claim_lines_qty" CHECK ("free_claim_lines"."qty" > 0)
);
--> statement-breakpoint
ALTER TABLE "free_claim_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "free_claims" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "free_claims_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"claim_no" text NOT NULL,
	"date" date NOT NULL,
	"reference" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"paid_date" date,
	"paid_amount" numeric(12, 2) DEFAULT 0 NOT NULL,
	"paid_reference" text DEFAULT '' NOT NULL,
	CONSTRAINT "free_claims_claimNo_unique" UNIQUE("claim_no")
);
--> statement-breakpoint
ALTER TABLE "free_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "free_claim_lines" ADD CONSTRAINT "free_claim_lines_claim_id_free_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "public"."free_claims"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_claim_lines" ADD CONSTRAINT "free_claim_lines_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "free_claim_lines" ADD CONSTRAINT "free_claim_lines_sap_code_items_sap_code_fk" FOREIGN KEY ("sap_code") REFERENCES "public"."items"("sap_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "no_api_access" ON "free_claim_lines" AS PERMISSIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "no_api_access" ON "free_claims" AS PERMISSIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);