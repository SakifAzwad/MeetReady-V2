import { sql, type SQL } from "drizzle-orm";
import { bookingHosts, bookings } from "@/db/schema";

/**
 * Day 30: "this user is a host of this booking": a row in booking_hosts. For a
 * personal booking that's its host (the trigger adds the row); for a team
 * meeting it's every host, organizer or not. EXISTS, not a join, so a meeting
 * with three hosts is still one row (the Day 29 lesson about joins).
 * A team member who isn't in the meeting gets nothing, like anyone else.
 */
export const hostedBy = (userId: string): SQL =>
  sql`exists (select 1 from ${bookingHosts} where ${bookingHosts.bookingId} = ${bookings.id} and ${bookingHosts.hostId} = ${userId})`;
