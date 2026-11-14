import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/site/legal-page";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: "What MeetReady stores, what it reads from Google Calendar, and how to remove it.",
};

/*
 * Linked from Google's OAuth consent screen (Branding page), as Google
 * requires before an app asking for calendar access can be published.
 * Written to match what the code actually does: every claim here has a
 * place in the code (see the Day 15 doc). Change the code, change this page.
 */
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy policy"
      intro={
        <p>
          MeetReady is a scheduling app built by Sakif Azwad. This page says, in plain words, what it stores
          about hosts and guests, what it reads from Google, who helps run it, and how to have your data
          removed.
        </p>
      }
    >
      <LegalSection title="If you host (you signed in with Google)">
        <ul>
          <li>
            <strong>From your Google account at sign-in:</strong> your name, email address and profile
            picture. Nothing else.
          </li>
          <li>
            <strong>What you set up:</strong> your username, timezone, working hours, date overrides, meeting
            types and the questions you ask guests.
          </li>
          <li>
            <strong>Your sign-in session:</strong> a session record with the browser&apos;s IP address and
            user agent, so a session can be recognised and ended.
          </li>
          <li>
            <strong>Your bookings:</strong> the meetings guests book with you, including what they tell you.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="If you book a meeting (a guest)">
        <ul>
          <li>
            <strong>What you type:</strong> your name, email address, timezone, any notes and your answers to
            the host&apos;s questions. The host sees all of it; that&apos;s what it&apos;s for.
          </li>
          <li>
            <strong>If the host has connected Google Calendar:</strong> the meeting is added to their calendar
            with your name and email address (not your notes or answers), and Google may create a Meet link
            for it. You are not added as a guest on their Google event, so Google doesn&apos;t email you.
          </li>
          <li>
            <strong>Emails:</strong> a confirmation with a calendar invite, a private link to cancel or move
            the meeting, and reminders a day and an hour before it. The link is stored twice, neither time as
            itself: a scrambled (hashed) form to check it, and an encrypted copy so later emails such as
            reminders can include it. The key to that copy is not kept in the database, so the link can&apos;t
            be rebuilt from the database alone.
          </li>
          <li>You don&apos;t need an account, and no cookies are set when you book.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Google Calendar (only if a host connects it)">
        <p>
          Connecting Google Calendar is optional. If a host connects it, MeetReady asks Google for two
          permissions:
        </p>
        <ul>
          <li>
            <strong>See when you&apos;re busy</strong> (free/busy). MeetReady reads only the start and end
            times of busy periods in your primary calendar, to hide those times on your booking page. It never
            receives the titles, descriptions, locations or guests of your events: this permission can&apos;t
            see them. Busy times are kept in a short-lived cache for at most one hour, and are not stored in
            the database.
          </li>
          <li>
            <strong>Add, change and remove events</strong>. Used only for the events of your own MeetReady
            bookings: adding them to your calendar, moving them when a booking is rescheduled, and removing
            them when it&apos;s cancelled. It is never used to read, change or delete any other event.
          </li>
        </ul>
        <p>
          The access tokens Google issues are stored encrypted. <strong>Disconnect</strong> on the
          Availability page revokes MeetReady&apos;s access at Google and deletes the tokens. You can also
          remove access at any time in your{" "}
          <a href="https://myaccount.google.com/connections" rel="noopener noreferrer">
            Google Account settings
          </a>
          .
        </p>
        <p>
          MeetReady&apos;s use and transfer to any other app of information received from Google APIs will
          adhere to the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            rel="noopener noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. Google user data is not sold, not used for advertising,
          not used to train AI models, and not read by people, except with your permission, for security, or
          when the law requires it.
        </p>
      </LegalSection>

      <LegalSection title="Protecting the service">
        <ul>
          <li>
            <strong>Rate limits:</strong> to stop abuse, the number of requests from an IP address, to one
            guest email or to one booking link is counted. Only scrambled (keyed hash) versions are kept, for
            at most an hour.
          </li>
          <li>
            <strong>Error reports:</strong> when something breaks, a technical report is sent to Sentry.
            Reports are stripped of cookies, IP addresses, email addresses, form contents and booking links
            before they leave the app.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="Cookies and browser storage">
        <p>
          One cookie, for hosts who are signed in: it keeps you signed in. The booking page remembers whether
          you prefer a 12-hour or 24-hour clock in your browser&apos;s local storage. There are no advertising
          or analytics cookies, and no tracking across sites.
        </p>
      </LegalSection>

      <LegalSection title="Who helps run MeetReady">
        <p>These services process data on MeetReady&apos;s behalf, only to provide the parts listed:</p>
        <ul>
          <li>Vercel: hosting the website (United States).</li>
          <li>Neon: the database (AWS, United States, US East).</li>
          <li>Upstash: rate-limit counters and the calendar cache (AWS, US East).</li>
          <li>Resend: sending emails.</li>
          <li>
            Inngest: running background work (sending emails and reminders, updating Google Calendar, and
            trying again when that fails). It receives booking ids and times, never names, email addresses or
            booking links.
          </li>
          <li>Sentry: error reports, stripped as described above.</li>
          <li>Google: sign-in and, if connected, Google Calendar.</li>
        </ul>
        <p>Data is not sold or shared with anyone else.</p>
      </LegalSection>

      <LegalSection title="Keeping and deleting data">
        <p>
          Accounts and bookings are kept until you ask for them to be deleted. To have your account, or a
          booking you made as a guest, removed, email <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>{" "}
          from the address involved. It will be done within 30 days, and you&apos;ll get a reply when it is.
          Guests can cancel a booking themselves at any time from the link in their email.
        </p>
      </LegalSection>

      <LegalSection title="Changes and contact">
        <p>
          If this policy changes, this page changes first, with a new date at the top. Questions:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. See also the{" "}
          <Link href="/terms">terms of use</Link>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
