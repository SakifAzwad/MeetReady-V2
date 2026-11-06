CREATE TYPE "public"."booking_status" AS ENUM('confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."location_type" AS ENUM('google_meet', 'zoom', 'phone', 'in_person');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "availability_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"day_of_week" smallint NOT NULL,
	"start_time" time NOT NULL,
	"end_time" time NOT NULL,
	CONSTRAINT "availability_rules_dow_check" CHECK ("availability_rules"."day_of_week" between 0 and 6),
	CONSTRAINT "availability_rules_order_check" CHECK ("availability_rules"."end_time" > "availability_rules"."start_time")
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_type_id" uuid NOT NULL,
	"host_id" text NOT NULL,
	"guest_name" varchar(120) NOT NULL,
	"guest_email" varchar(254) NOT NULL,
	"guest_time_zone" text NOT NULL,
	"guest_notes" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" "booking_status" DEFAULT 'confirmed' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"cancellation_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bookings_time_order_check" CHECK ("bookings"."ends_at" > "bookings"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "date_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"date" date NOT NULL,
	"start_time" time,
	"end_time" time,
	CONSTRAINT "date_overrides_times_check" CHECK (("date_overrides"."start_time" is null and "date_overrides"."end_time" is null)
       or ("date_overrides"."start_time" is not null and "date_overrides"."end_time" is not null and "date_overrides"."end_time" > "date_overrides"."start_time"))
);
--> statement-breakpoint
CREATE TABLE "event_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"title" varchar(120) NOT NULL,
	"slug" varchar(80) NOT NULL,
	"description" text,
	"duration_minutes" integer NOT NULL,
	"slot_interval_minutes" integer,
	"location_type" "location_type" DEFAULT 'google_meet' NOT NULL,
	"location_value" text,
	"color" varchar(7) DEFAULT '#2563eb' NOT NULL,
	"buffer_before_minutes" integer DEFAULT 0 NOT NULL,
	"buffer_after_minutes" integer DEFAULT 0 NOT NULL,
	"minimum_notice_minutes" integer DEFAULT 60 NOT NULL,
	"booking_window_days" integer DEFAULT 60,
	"max_bookings_per_day" integer,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "event_types_user_slug_unique" UNIQUE("user_id","slug"),
	CONSTRAINT "event_types_duration_check" CHECK ("event_types"."duration_minutes" between 5 and 720),
	CONSTRAINT "event_types_interval_check" CHECK ("event_types"."slot_interval_minutes" is null or "event_types"."slot_interval_minutes" > 0),
	CONSTRAINT "event_types_buffers_check" CHECK ("event_types"."buffer_before_minutes" >= 0 and "event_types"."buffer_after_minutes" >= 0),
	CONSTRAINT "event_types_notice_check" CHECK ("event_types"."minimum_notice_minutes" >= 0),
	CONSTRAINT "event_types_window_check" CHECK ("event_types"."booking_window_days" is null or "event_types"."booking_window_days" >= 1),
	CONSTRAINT "event_types_max_per_day_check" CHECK ("event_types"."max_bookings_per_day" is null or "event_types"."max_bookings_per_day" >= 1),
	CONSTRAINT "event_types_slug_check" CHECK ("event_types"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "event_types_color_check" CHECK ("event_types"."color" ~ '^#[0-9a-fA-F]{6}$')
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"username" varchar(40),
	"time_zone" text DEFAULT 'UTC' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email"),
	CONSTRAINT "user_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_rules" ADD CONSTRAINT "availability_rules_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "date_overrides" ADD CONSTRAINT "date_overrides_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_index" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "availability_rules_user_id_index" ON "availability_rules" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "bookings_host_id_starts_at_index" ON "bookings" USING btree ("host_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_event_type_id_index" ON "bookings" USING btree ("event_type_id");--> statement-breakpoint
CREATE INDEX "date_overrides_user_id_date_index" ON "date_overrides" USING btree ("user_id","date");--> statement-breakpoint
CREATE INDEX "session_user_id_index" ON "session" USING btree ("user_id");