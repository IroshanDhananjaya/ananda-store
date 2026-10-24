ALTER TABLE "items" ADD COLUMN "location_number" text DEFAULT '' NOT NULL;--> statement-breakpoint
-- Existing items go where most of their stock is kept now; items with no stock stay "" (not set)
UPDATE "items" i SET "location_number" = (
  SELECT s."location_number" FROM "stock" s
  JOIN "locations" l ON l."location_number" = s."location_number"
  WHERE s."sap_code" = i."sap_code"
  ORDER BY s."available_qty" DESC, s."seq"
  LIMIT 1
)
WHERE EXISTS (
  SELECT 1 FROM "stock" s
  JOIN "locations" l ON l."location_number" = s."location_number"
  WHERE s."sap_code" = i."sap_code"
);
