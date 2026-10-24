CREATE POLICY "no_api_access" ON "expenses" AS PERMISSIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "no_api_access" ON "items" AS PERMISSIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "no_api_access" ON "locations" AS PERMISSIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "no_api_access" ON "order_items" AS PERMISSIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "no_api_access" ON "orders" AS PERMISSIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "no_api_access" ON "payment_allocations" AS PERMISSIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "no_api_access" ON "payments" AS PERMISSIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "no_api_access" ON "routes" AS PERMISSIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "no_api_access" ON "sale_lines" AS PERMISSIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "no_api_access" ON "sales" AS PERMISSIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "no_api_access" ON "shops" AS PERMISSIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "no_api_access" ON "stock" AS PERMISSIVE FOR ALL TO "anon", "authenticated" USING (false) WITH CHECK (false);