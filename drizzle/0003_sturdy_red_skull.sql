CREATE TABLE "bot_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "bot_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"cycle_id" uuid,
	"prev_step" text,
	"step" text,
	"outcome" text,
	"reason" text,
	"duration_ms" integer,
	"amount" integer
);
--> statement-breakpoint
CREATE INDEX "bot_events_occurred_at_idx" ON "bot_events" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "bot_events_name_occurred_at_idx" ON "bot_events" USING btree ("name","occurred_at");--> statement-breakpoint
CREATE INDEX "bot_events_cycle_id_idx" ON "bot_events" USING btree ("cycle_id");