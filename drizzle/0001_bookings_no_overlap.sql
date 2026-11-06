-- Double-booking protection, enforced by Postgres itself.
--
-- "No two CONFIRMED bookings of the same host may overlap in time."
--
-- Why a constraint and not just "SELECT for overlaps, then INSERT" in app code:
-- two guests can click "Book" on the same slot at the same moment. Both SELECTs
-- see a free slot, both INSERTs succeed -> double booking. That's a race that
-- app code alone can't close without locks. An exclusion constraint is checked
-- inside the database at insert time, so exactly one of the two inserts wins and
-- the other fails with SQLSTATE 23P01 (exclusion_violation), which the booking
-- action turns into "Sorry, that slot was just taken".
--
-- btree_gist lets a GiST index combine plain equality (host_id WITH =) with
-- range overlap (&&). Neon supports it.
--
-- '[)' = half-open range: 10:00–10:30 and 10:30–11:00 do not conflict.
-- WHERE status = 'confirmed': cancelled bookings free the slot again.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "host_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("status" = 'confirmed');
