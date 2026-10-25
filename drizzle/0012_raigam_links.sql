CREATE TABLE "raigam_links" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "raigam_links_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"kind" text NOT NULL,
	"raigam_id" integer NOT NULL,
	"app_id" text NOT NULL,
	CONSTRAINT "raigam_links_kind_raigamId_unique" UNIQUE("kind","raigam_id"),
	CONSTRAINT "raigam_links_kind" CHECK ("raigam_links"."kind" in ('Item', 'Store', 'Route'))
);
--> statement-breakpoint
ALTER TABLE "raigam_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "no_api_access" ON "raigam_links" AS PERMISSIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);