CREATE TABLE "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "expenses_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"expense_no" text NOT NULL,
	"date" date NOT NULL,
	"category" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" text NOT NULL,
	CONSTRAINT "expenses_expenseNo_unique" UNIQUE("expense_no")
);
--> statement-breakpoint
ALTER TABLE "expenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "items" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "items_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"sap_code" text NOT NULL,
	"description" text NOT NULL,
	"package_details" text DEFAULT '' NOT NULL,
	"uom" text NOT NULL,
	"cost_price" numeric(12, 2) NOT NULL,
	"wholesale_price" numeric(12, 2) NOT NULL,
	"retail_price" numeric(12, 2) NOT NULL,
	CONSTRAINT "items_sapCode_unique" UNIQUE("sap_code")
);
--> statement-breakpoint
ALTER TABLE "items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "locations" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "locations_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"location_number" text NOT NULL,
	"item_group" text NOT NULL,
	CONSTRAINT "locations_locationNumber_unique" UNIQUE("location_number")
);
--> statement-breakpoint
ALTER TABLE "locations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "order_items_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" text NOT NULL,
	"item_code" text NOT NULL,
	"ordered_qty" integer NOT NULL,
	"received_qty" integer NOT NULL,
	"remarks" text DEFAULT '' NOT NULL,
	"posted_location" text,
	CONSTRAINT "order_items_orderId_itemCode_unique" UNIQUE("order_id","item_code")
);
--> statement-breakpoint
ALTER TABLE "order_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "orders" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "orders_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"order_id" text NOT NULL,
	"invoice_number" text DEFAULT '' NOT NULL,
	"order_date" date NOT NULL,
	"received_date" date,
	"received_time" text,
	"cheque_number" text DEFAULT '' NOT NULL,
	"cheque_deposit_date" date,
	"total_bill_amount" numeric(12, 2) NOT NULL,
	"posted_to_stock" boolean DEFAULT false NOT NULL,
	CONSTRAINT "orders_orderId_unique" UNIQUE("order_id")
);
--> statement-breakpoint
ALTER TABLE "orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payment_allocations" (
	"payment_id" text NOT NULL,
	"position" integer NOT NULL,
	"sale_id" text,
	"amount" numeric(12, 2) NOT NULL,
	CONSTRAINT "payment_allocations_payment_id_position_pk" PRIMARY KEY("payment_id","position")
);
--> statement-breakpoint
ALTER TABLE "payment_allocations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "payments_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"receipt_no" text NOT NULL,
	"date" date NOT NULL,
	"shop_id" text NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"method" text NOT NULL,
	"cheque_number" text DEFAULT '' NOT NULL,
	"cheque_date" date,
	"reference" text DEFAULT '' NOT NULL,
	CONSTRAINT "payments_receiptNo_unique" UNIQUE("receipt_no")
);
--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "routes" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "routes_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"route_code" text NOT NULL,
	"route_name" text NOT NULL,
	"area" text DEFAULT '' NOT NULL,
	"visit_days" text[] DEFAULT '{}'::text[] NOT NULL,
	"sales_rep" text DEFAULT '' NOT NULL,
	"vehicle_number" text DEFAULT '' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	CONSTRAINT "routes_routeCode_unique" UNIQUE("route_code")
);
--> statement-breakpoint
ALTER TABLE "routes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sale_lines" (
	"id" text PRIMARY KEY NOT NULL,
	"sale_id" text NOT NULL,
	"position" integer NOT NULL,
	"sap_code" text NOT NULL,
	"location_number" text NOT NULL,
	"qty" integer NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"cost_price" numeric(12, 2) NOT NULL,
	CONSTRAINT "sale_lines_saleId_sapCode_locationNumber_unique" UNIQUE("sale_id","sap_code","location_number")
);
--> statement-breakpoint
ALTER TABLE "sale_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sales" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "sales_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"sale_no" text NOT NULL,
	"date" date NOT NULL,
	"shop_id" text NOT NULL,
	"rep_name" text DEFAULT '' NOT NULL,
	"discount" numeric(12, 2) NOT NULL,
	"status" text NOT NULL,
	"loaded_date" date,
	"vehicle_number" text DEFAULT '' NOT NULL,
	"delivered_date" date,
	"due_date" date NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	CONSTRAINT "sales_saleNo_unique" UNIQUE("sale_no"),
	CONSTRAINT "sales_status" CHECK ("sales"."status" in ('Ordered', 'Loaded', 'Delivered'))
);
--> statement-breakpoint
ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "shops" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "shops_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"shop_code" text NOT NULL,
	"shop_name" text NOT NULL,
	"owner_name" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"address" text DEFAULT '' NOT NULL,
	"town" text DEFAULT '' NOT NULL,
	"map_link" text DEFAULT '' NOT NULL,
	"route_id" text NOT NULL,
	"credit_limit" numeric(12, 2) NOT NULL,
	"credit_days" integer NOT NULL,
	"opening_balance" numeric(12, 2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	CONSTRAINT "shops_shopCode_unique" UNIQUE("shop_code")
);
--> statement-breakpoint
ALTER TABLE "shops" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "stock" (
	"id" text PRIMARY KEY NOT NULL,
	"seq" bigint GENERATED ALWAYS AS IDENTITY (sequence name "stock_seq_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"sap_code" text NOT NULL,
	"location_number" text NOT NULL,
	"available_qty" integer NOT NULL,
	"issued_qty" integer NOT NULL,
	"last_update" date,
	CONSTRAINT "stock_sapCode_locationNumber_unique" UNIQUE("sap_code","location_number"),
	CONSTRAINT "stock_qty_not_negative" CHECK ("stock"."available_qty" >= 0 and "stock"."issued_qty" >= 0)
);
--> statement-breakpoint
ALTER TABLE "stock" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("order_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_item_code_items_sap_code_fk" FOREIGN KEY ("item_code") REFERENCES "public"."items"("sap_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_lines" ADD CONSTRAINT "sale_lines_sap_code_items_sap_code_fk" FOREIGN KEY ("sap_code") REFERENCES "public"."items"("sap_code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shops" ADD CONSTRAINT "shops_route_id_routes_id_fk" FOREIGN KEY ("route_id") REFERENCES "public"."routes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock" ADD CONSTRAINT "stock_sap_code_items_sap_code_fk" FOREIGN KEY ("sap_code") REFERENCES "public"."items"("sap_code") ON DELETE no action ON UPDATE no action;