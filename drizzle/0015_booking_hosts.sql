CREATE TYPE "public"."team_event_kind" AS ENUM('collective', 'round_robin');--> statement-breakpoint
CREATE TABLE "booking_hosts" (
	"booking_id" uuid NOT NULL,
	"host_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"active" boolean NOT NULL,
	CONSTRAINT "booking_hosts_booking_id_host_id_pk" PRIMARY KEY("booking_id","host_id")
);
--> statement-breakpoint
CREATE TABLE "event_type_hosts" (
	"event_type_id" uuid NOT NULL,
	"user_id" text NOT NULL,
	"position" smallint NOT NULL,
	CONSTRAINT "event_type_hosts_event_type_id_user_id_pk" PRIMARY KEY("event_type_id","user_id")
);
--> statement-breakpoint
ALTER TABLE "event_types" ALTER COLUMN "user_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "event_types" ADD COLUMN "team_id" uuid;--> statement-breakpoint
ALTER TABLE "event_types" ADD COLUMN "team_kind" "team_event_kind";--> statement-breakpoint
ALTER TABLE "booking_hosts" ADD CONSTRAINT "booking_hosts_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "booking_hosts" ADD CONSTRAINT "booking_hosts_host_id_user_id_fk" FOREIGN KEY ("host_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_type_hosts" ADD CONSTRAINT "event_type_hosts_event_type_id_event_types_id_fk" FOREIGN KEY ("event_type_id") REFERENCES "public"."event_types"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_type_hosts" ADD CONSTRAINT "event_type_hosts_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "booking_hosts_host_id_starts_at_index" ON "booking_hosts" USING btree ("host_id","starts_at");--> statement-breakpoint
CREATE INDEX "event_type_hosts_user_id_index" ON "event_type_hosts" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_team_slug_unique" UNIQUE("team_id","slug");--> statement-breakpoint
ALTER TABLE "event_types" ADD CONSTRAINT "event_types_owner_check" CHECK (("event_types"."user_id" is null) <> ("event_types"."team_id" is null) and ("event_types"."team_id" is null) = ("event_types"."team_kind" is null));--> statement-breakpoint
-- ─── Hand-written below: Drizzle can't express triggers or EXCLUDE ───────────
--
-- Day 29: the no-double-booking guarantee moves to booking_hosts, so it covers
-- every host of every meeting (a collective team meeting has several). The old
-- constraint on bookings stays: migrations are additive, and it still holds for
-- each booking's organizer.
--
-- 1. Every existing booking gets its one host row.
INSERT INTO "booking_hosts" ("booking_id", "host_id", "starts_at", "ends_at", "active")
SELECT "id", "host_id", "starts_at", "ends_at", "status" = 'confirmed' FROM "bookings";
--> statement-breakpoint
-- 2. A host row's times and "active" always come from its booking: whatever the
--    app writes there is replaced, so the two tables can't disagree.
CREATE FUNCTION "booking_hosts_fill"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT b."starts_at", b."ends_at", b."status" = 'confirmed'
    INTO NEW."starts_at", NEW."ends_at", NEW."active"
    FROM "bookings" b WHERE b."id" = NEW."booking_id";
  RETURN NEW;
END $$;
--> statement-breakpoint
CREATE TRIGGER "booking_hosts_fill" BEFORE INSERT OR UPDATE ON "booking_hosts"
  FOR EACH ROW EXECUTE FUNCTION "booking_hosts_fill"();
--> statement-breakpoint
-- 3. A new booking gets its organizer's row (host_id) automatically, so every
--    code path that inserts a booking is covered, old ones included.
CREATE FUNCTION "bookings_add_host"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "booking_hosts" ("booking_id", "host_id", "starts_at", "ends_at", "active")
    VALUES (NEW."id", NEW."host_id", NEW."starts_at", NEW."ends_at", NEW."status" = 'confirmed');
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER "bookings_add_host" AFTER INSERT ON "bookings"
  FOR EACH ROW EXECUTE FUNCTION "bookings_add_host"();
--> statement-breakpoint
-- 4. A moved or cancelled booking moves or frees every one of its hosts. The
--    UPDATE fires booking_hosts_fill, which re-reads the booking. An overlap for
--    ANY host fails this statement, and so the booking's own UPDATE (23P01).
CREATE FUNCTION "bookings_sync_hosts"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "booking_hosts"
    SET "starts_at" = NEW."starts_at", "ends_at" = NEW."ends_at", "active" = NEW."status" = 'confirmed'
    WHERE "booking_id" = NEW."id";
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER "bookings_sync_hosts" AFTER UPDATE OF "starts_at", "ends_at", "status" ON "bookings"
  FOR EACH ROW
  WHEN (OLD."starts_at" IS DISTINCT FROM NEW."starts_at"
     OR OLD."ends_at" IS DISTINCT FROM NEW."ends_at"
     OR OLD."status" IS DISTINCT FROM NEW."status")
  EXECUTE FUNCTION "bookings_sync_hosts"();
--> statement-breakpoint
-- 5. The guarantee: no host is in two active meetings at once. Same shape as
--    bookings_no_overlap (Day 1): half-open ranges, so back-to-back is fine.
ALTER TABLE "booking_hosts"
  ADD CONSTRAINT "booking_hosts_no_overlap"
  EXCLUDE USING gist (
    "host_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("active");
