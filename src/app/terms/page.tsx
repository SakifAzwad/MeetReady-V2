import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, LegalSection } from "@/components/site/legal-page";
import { CONTACT_EMAIL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Terms of use",
  description: "The terms for using MeetReady, a portfolio scheduling app.",
};

/* Linked from Google's OAuth consent screen and the site footer. Short on purpose. */
export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of use"
      intro={
        <p>
          MeetReady is a portfolio project by Sakif Azwad, free to use. By using it, as a host or as a guest,
          you agree to these terms.
        </p>
      }
    >
      <LegalSection title="What MeetReady is">
        <p>
          A scheduling app: hosts share a booking link, guests pick a time. It&apos;s run by one person as a
          demonstration of their work, not as a commercial service. It&apos;s provided as it is, without
          guarantees that it will always be available, error-free, or suitable for any particular purpose.
          Don&apos;t rely on it for anything critical.
        </p>
      </LegalSection>

      <LegalSection title="Using it fairly">
        <ul>
          <li>
            Book meetings only for yourself, or for someone who agreed to it, with a real email address.
          </li>
          <li>
            Don&apos;t use MeetReady to send unwanted messages, to harass anyone, or to fill someone&apos;s
            calendar.
          </li>
          <li>
            Don&apos;t try to get around the rate limits, reach other people&apos;s data, or disrupt the
            service.
          </li>
          <li>Hosts: choose a username that isn&apos;t misleading or someone else&apos;s name or brand.</li>
        </ul>
        <p>Accounts and bookings that break these rules may be removed without notice.</p>
      </LegalSection>

      <LegalSection title="Your meetings and your data">
        <p>
          Hosts and guests are responsible for the meetings they arrange and for what they write in them. What
          is stored, and how to have it deleted, is described in the{" "}
          <Link href="/privacy">privacy policy</Link>.
        </p>
      </LegalSection>

      <LegalSection title="Liability">
        <p>
          As far as the law allows, MeetReady and its author aren&apos;t liable for missed, double-booked or
          wrongly-timed meetings, or for any loss from using or not being able to use the service.
        </p>
      </LegalSection>

      <LegalSection title="Changes and contact">
        <p>
          These terms may change; this page will show the new date at the top. Questions:{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
