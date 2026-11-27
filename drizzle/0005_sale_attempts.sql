CREATE TABLE "sale_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cycle_id" uuid NOT NULL,
	"status" text NOT NULL,
	"total_cents" bigint NOT NULL,
	"product_code" text NOT NULL,
	"payment_method_code" text NOT NULL,
	"customer_segment" text NOT NULL,
	"error_kind" text,
	"is_simulated" boolean NOT NULL,
	"customer_id" integer NOT NULL,
	"erp_sale_id" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bot_events" ADD COLUMN "is_simulated" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sale_attempts_cycle_id_key" ON "sale_attempts" USING btree ("cycle_id");--> statement-breakpoint
CREATE INDEX "sale_attempts_status_updated_at_idx" ON "sale_attempts" USING btree ("status","updated_at");