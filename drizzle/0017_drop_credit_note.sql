-- Credit notes are written in the delivery note now: keep any already saved there
UPDATE "sales" SET "delivery_note" = CASE WHEN "delivery_note" = '' THEN "credit_note" ELSE "delivery_note" || ' · ' || "credit_note" END WHERE "credit_note" <> '';--> statement-breakpoint
ALTER TABLE "sales" DROP COLUMN "credit_note";
