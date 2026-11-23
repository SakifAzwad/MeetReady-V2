/*
 * Day 29: whose booking page a widget is on. A host's (/{username}/{slug}) or
 * a team's (/team/{team}/{slug}). The slots API and the booking action take
 * one or the other. Plain functions, outside any "use client" file, so server
 * code can use them too (the Day 6 / Day 7 rule).
 */

export type BookingOwner = { username: string; team?: undefined } | { team: string; username?: undefined };

/** What a booking page needs to know about its owner. */
export type OwnerInfo = {
  username: string;
  hostName: string;
  team?: { slug: string; name: string };
};

export const ownerOf = (e: OwnerInfo): BookingOwner =>
  e.team ? { team: e.team.slug } : { username: e.username };

/** For TanStack Query keys: "sakif" or "team:acme" (a team and a user may share a name). */
export const ownerKey = (o: BookingOwner): string => (o.team !== undefined ? `team:${o.team}` : o.username);

/** "Sakif" for a host, the team's name for a team: "You're booked with …", "… works 9–5". */
export const shortName = (e: OwnerInfo): string => e.team?.name ?? e.hostName.split(" ")[0] ?? e.hostName;
