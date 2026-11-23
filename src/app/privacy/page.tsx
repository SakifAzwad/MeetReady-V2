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
          <li id="ai-assistants">
            <strong>If you connect an AI assistant</strong> (such as Claude or ChatGPT, through
            MeetReady&apos;s MCP server): after you sign in and approve it, the assistant can read your
            meeting types, free times and bookings, including guests&apos; names, email addresses, notes and
            answers, when you ask it something that needs them. If you let it, it can also book meetings for
            you at your free times; the guest then gets an email from MeetReady saying you scheduled it, with
            a link to reschedule or cancel. It can move or cancel your upcoming bookings too, including ones
            guests made: the guest is emailed that you moved or cancelled it (with the reason it passes on,
            stripped of links and contact details), and you get a copy. What it reads goes to that
            assistant&apos;s provider, under their terms and your settings there. MeetReady stores which
            assistant you allowed, what it may do, and its sign-in tokens (the long-lived ones only in a
            scrambled, hashed form). Disconnect it on your dashboard at any time: it stops working at once.
          </li>
          <li id="webhooks">
            <strong>If you add a webhook:</strong> when a booking is made, moved or cancelled, MeetReady sends
            its details to the address you chose: the time, the meeting type, and the guest&apos;s name, email
            and timezone (never their notes, answers or a cancellation reason). What happens there is up to
            you and that service. Each delivery is kept for 30 days so you can see what was sent, then
            deleted. The signing secret is stored encrypted.
          </li>
          <li id="teams">
            <strong>If you join or create a team:</strong> everyone in it sees your name, email address and
            picture. A team&apos;s owner makes invite links: each works for one person, once, within 7 days,
            and MeetReady stores only a scrambled (hashed) form of it. A member can leave at any time; the
            owner can remove members or delete the team.
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
            <strong>A short brief for the host, written by AI:</strong> if you leave notes or answer the
            host&apos;s questions, that text, your first name and the meeting type are sent to Groq, which
            writes a summary and agenda for the host. Your email address and the meeting time are not sent.
            Groq isn&apos;t allowed to use it to train models, and MeetReady has asked Groq not to keep it
            (Zero Data Retention). The brief is stored with the booking and shown only to the host.
          </li>
          <li id="booking-assistant">
            <strong>Finding a time by describing it (&ldquo;Tell us when suits you&rdquo;):</strong> what you
            type in that box and your timezone are sent to Groq, with the meeting type, the host&apos;s first
            name and the free times MeetReady finds for your request. Groq&apos;s model suggests times; it
            can&apos;t book anything. Your name and email address are not sent: the box comes before the form.
            MeetReady doesn&apos;t store what you type there, only that a request was made and how long it
            took. The same Groq terms apply: no training, not kept (Zero Data Retention). The box is optional:
            every time is also on the page to pick yourself.
          </li>
          <li>
            <strong>Emails:</strong> a confirmation with a calendar invite, a private link to cancel or move
            the meeting, and reminders a day and an hour before it. The link is stored twice, neither time as
            itself: a scrambled (hashed) form to check it, and an encrypted copy so later emails such as
            reminders can include it. The key to that copy is not kept in the database, so the link can&apos;t
            be rebuilt from the database alone.
          </li>
          <li>
            <strong>If the host uses an AI assistant:</strong> a host can connect one to their MeetReady
            account (see above). It can then read your booking, including your notes and answers, when the
            host asks it about your meeting. A host can also book, move or cancel a meeting with you through
            it: you&apos;ll get an email from MeetReady saying the host did it, and for a booked or moved
            meeting you can reschedule or cancel from there.
          </li>
          <li>
            <strong>If the host uses webhooks:</strong> your booking&apos;s time, your name, email and
            timezone can be sent to a service the host connected (such as their calendar tool or CRM), when
            you book, move or cancel. Your notes and answers aren&apos;t sent that way.
          </li>
          <li id="embed">
            <strong>Booking on another website:</strong> a host can put MeetReady&apos;s booking calendar on
            their own site. It stays MeetReady&apos;s page inside a frame: what you type goes to MeetReady,
            not to that site. When you book, the site is told the meeting type and its start and end times,
            never your name, email, notes or answers.
          </li>
          <li>
            <strong>After the meeting:</strong> the host can mark that you didn&apos;t show up. It&apos;s a
            note in their own records and counts in their statistics; you aren&apos;t emailed about it, and
            they can undo it.
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
          <li>
            Groq: writing the host&apos;s meeting brief from a guest&apos;s notes and answers, and suggesting
            times from what a guest types in &ldquo;Tell us when suits you&rdquo; (see above).
          </li>
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
