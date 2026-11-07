import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from "@react-email/components";

/*
 * One template for every booking email: confirmed / rescheduled / cancelled,
 * to the guest or the host. React Email turns it into email-safe HTML (inline
 * styles, tables) plus a plain-text version. Guest-supplied text (name, notes)
 * is escaped by React like any JSX, so a guest can't inject HTML into the
 * host's inbox.
 */

export type BookingEmailProps = {
  kind: "confirmed" | "rescheduled" | "cancelled";
  audience: "guest" | "host";
  eventTitle: string;
  hostName: string;
  guestName: string;
  /** Already formatted in the recipient's timezone. */
  when: string;
  previousWhen?: string;
  location?: string;
  guestEmail?: string;
  guestNotes?: string | null;
  cancelledBy?: "host" | "guest" | null;
  cancellationReason?: string | null;
  /** Guest: manage link (cancel/reschedule). Host: dashboard link. */
  actionUrl?: string;
};

export function bookingEmailHeading(p: BookingEmailProps): string {
  const host = p.hostName.split(" ")[0];
  if (p.kind === "confirmed")
    return p.audience === "guest" ? `You're booked with ${host}` : `New booking: ${p.guestName}`;
  if (p.kind === "rescheduled")
    return p.audience === "guest" ? "Your meeting has moved" : `${p.guestName} moved their meeting`;
  if (p.audience === "host") return `${p.guestName} cancelled`;
  return p.cancelledBy === "host" ? `${host} cancelled your meeting` : "Your meeting is cancelled";
}

// The Daylight palette, as plain hex: email clients don't support CSS variables.
// Web fonts are unreliable in email, so a system stack stands in for Figtree.
const INK = "#1d2540";
const MUTED = "#5d6680";
const styles = {
  body: {
    backgroundColor: "#f5f7fb",
    color: INK,
    fontFamily: "-apple-system, 'Segoe UI', Helvetica, Arial, sans-serif",
    margin: 0,
    padding: "24px 0",
  },
  brand: {
    color: INK,
    fontSize: 16,
    fontWeight: 700,
    margin: "0 auto 12px",
    maxWidth: 520,
    padding: "0 4px",
  },
  card: {
    backgroundColor: "#ffffff",
    border: "1px solid #e2e6ef",
    borderRadius: 12,
    margin: "0 auto",
    maxWidth: 520,
    padding: 32,
  },
  heading: { color: INK, fontSize: 24, letterSpacing: "-0.01em", margin: "0 0 8px" },
  label: { color: MUTED, fontSize: 13, margin: "18px 0 2px" },
  value: { color: INK, fontSize: 16, margin: 0 },
  old: { color: MUTED, fontSize: 14, margin: "4px 0 0", textDecoration: "line-through" },
  button: {
    backgroundColor: INK,
    borderRadius: 8,
    color: "#ffffff",
    fontSize: 15,
    fontWeight: 600,
    padding: "12px 20px",
  },
  footer: { color: MUTED, fontSize: 12, marginTop: 24 },
};

export function BookingEmail(p: BookingEmailProps) {
  const heading = bookingEmailHeading(p);
  const cancelled = p.kind === "cancelled";
  return (
    <Html lang="en">
      <Head />
      <Preview>{`${heading}: ${p.eventTitle}, ${p.when}`}</Preview>
      <Body style={styles.body}>
        <Text style={styles.brand}>MeetReady</Text>
        <Container style={styles.card}>
          <Heading style={styles.heading}>{heading}</Heading>

          <Text style={styles.label}>What</Text>
          <Text style={styles.value}>
            {p.eventTitle} with {p.audience === "guest" ? p.hostName : p.guestName}
          </Text>

          <Text style={styles.label}>When</Text>
          <Text style={{ ...styles.value, ...(cancelled ? { textDecoration: "line-through" } : {}) }}>
            {p.when}
          </Text>
          {p.previousWhen && <Text style={styles.old}>{p.previousWhen}</Text>}

          {p.location && !cancelled && (
            <>
              <Text style={styles.label}>Where</Text>
              <Text style={styles.value}>{p.location}</Text>
            </>
          )}

          {p.audience === "host" && p.guestEmail && (
            <>
              <Text style={styles.label}>Guest</Text>
              <Text style={styles.value}>
                {p.guestName} ({p.guestEmail})
              </Text>
            </>
          )}

          {p.guestNotes && p.audience === "host" && !cancelled && (
            <>
              <Text style={styles.label}>Notes from {p.guestName}</Text>
              <Text style={{ ...styles.value, whiteSpace: "pre-line" }}>{p.guestNotes}</Text>
            </>
          )}

          {cancelled && p.cancellationReason && (
            <>
              <Text style={styles.label}>Reason</Text>
              <Text style={styles.value}>{p.cancellationReason}</Text>
            </>
          )}

          {p.actionUrl && (
            <Section style={{ marginTop: 28 }}>
              <Button href={p.actionUrl} style={styles.button}>
                {p.audience === "guest"
                  ? cancelled
                    ? "View booking"
                    : "Reschedule or cancel"
                  : "Open your bookings"}
              </Button>
            </Section>
          )}

          <Hr style={{ borderColor: "#e2e6ef", marginTop: 28 }} />
          <Text style={styles.footer}>
            {cancelled
              ? "The calendar invite attached removes this event from your calendar."
              : "A calendar invite is attached."}{" "}
            Sent by MeetReady.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
