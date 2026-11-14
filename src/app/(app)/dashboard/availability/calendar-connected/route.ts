import { after, NextResponse, type NextRequest } from "next/server";
import { requireOnboardedUser } from "@/server/auth/session";
import { connectCalendar } from "@/server/calendar";
import { jobs } from "@/server/jobs";

/*
 * Where Google (through Better Auth) sends the host back after the consent
 * screen. Better Auth has already saved the new tokens on the account; this
 * checks what was actually granted and switches the calendar on.
 *
 * A GET with a side effect, which is unusual: it's the OAuth return URL, so it
 * has to be. It's safe to hit again or to be sent here by someone else: it
 * only ever reads the signed-in host's own account and reflects what that
 * account really granted.
 */
export async function GET(request: NextRequest) {
  const user = await requireOnboardedUser();
  const outcome = await connectCalendar(user.id);
  // Day 17: bookings made before the calendar was connected go into it too (a background job).
  if (outcome === "connected") after(() => jobs.calendarConnected(user.id));
  return NextResponse.redirect(new URL(`/dashboard/availability?calendar=${outcome}`, request.url));
}
