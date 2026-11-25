import type { EventInfo } from "@/app/[username]/[slug]/facts-panel";
import { locationText } from "./booking-format";

/*
 * Day 30: what the booking widget needs to MOVE an existing booking, from the
 * booking itself. A personal booking is the host's page (username + slug); a
 * team meeting is the team's page, with the MEETING's hosts in the facts panel
 * (organizer first), the same people the slots API and the move check use.
 * A plain module, not a "use client" one: server pages call it (Day 6 rule).
 */
type MovableBooking = {
  hostUsername: string | null;
  eventSlug: string;
  eventTitle: string;
  durationMinutes: number;
  hostName: string;
  organizerName: string;
  hostTimeZone: string;
  locationType: Parameters<typeof locationText>[0]["locationType"];
  locationValue: string | null;
  meetUrl: string | null;
  team: { slug: string; name: string } | null;
  coHosts?: { name: string; timeZone: string }[];
};

export function bookingEventInfo(b: MovableBooking): EventInfo {
  const common = {
    username: b.hostUsername ?? "",
    slug: b.eventSlug,
    title: b.eventTitle,
    description: null,
    durationMinutes: b.durationMinutes,
    hostTimeZone: b.hostTimeZone,
    locationLabel: locationText(b),
  };
  if (!b.team) return { ...common, hostName: b.hostName };
  return {
    ...common,
    // For a team, sentences name the team ("You're booked with Acme Sales"), as on its booking page.
    hostName: b.team.name,
    team: {
      ...b.team,
      hosts: [
        { name: b.organizerName, timeZone: b.hostTimeZone },
        ...(b.coHosts ?? []).map((h) => ({ name: h.name, timeZone: h.timeZone })),
      ],
    },
  };
}
