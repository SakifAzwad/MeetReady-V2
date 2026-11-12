import { Check, ChevronDown } from "lucide-react";
import Link from "next/link";
import { SiteHeader } from "@/components/site/site-header";
import { PageTransition } from "@/components/motion";
import { SiteFooter } from "@/components/site/site-footer";
import { Button } from "@/components/ui/button";
import { appHost, env } from "@/lib/env";
import { REPO_URL } from "@/lib/site";
import { GuestPreview } from "./_landing/guest-preview";
import { HeroBands } from "./_landing/hero-bands";

/*
 * Landing page. The order follows the questions a visitor asks:
 *   what is it (hero + live two-band demo) → what would my guests see (real
 *   booking-page components) → how does it work → what can it do (built, and
 *   what's next, labelled honestly) → can I trust it (under the hood) → FAQ.
 * The bands carry the colour; every section around them stays quiet.
 */
export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <SiteHeader />

      <PageTransition>
        <main className="flex-1">
          <section className="mx-auto max-w-6xl px-5 pt-12 pb-16 sm:px-8 sm:pt-20">
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-end">
              <h1 className="animate-in-up text-[clamp(2.5rem,6vw,4.5rem)] leading-[1.02] font-bold text-balance">
                Meetings across timezones, without the maths.
              </h1>
              <div className="animate-in-up flex flex-col gap-5 [animation-delay:80ms] lg:pb-2">
                <p className="text-muted-foreground max-w-[46ch] text-lg leading-relaxed">
                  Share one link. Guests see your working hours laid over their own day, pick a time, and you
                  each get it on your own clock.
                </p>
                <div className="flex flex-wrap gap-3">
                  <Button asChild size="lg">
                    <Link href="/login">Create your booking page</Link>
                  </Button>
                  {env.DEMO_BOOKING_PATH && (
                    <Button asChild size="lg" variant="outline">
                      <Link href={env.DEMO_BOOKING_PATH}>See a live booking page</Link>
                    </Button>
                  )}
                </div>
              </div>
            </div>

            <div className="animate-in-up mt-12 [animation-delay:160ms]">
              <HeroBands />
            </div>
          </section>

          <Section
            id="guests"
            title="What your guests see"
            intro="This is the real booking page, running on sample data. Pick a time."
          >
            <GuestPreview address={`${appHost}${env.DEMO_BOOKING_PATH ?? "/sakif/intro"}`} />
          </Section>

          <Section id="how-it-works" title="How it works">
            <ol className="grid gap-8 md:grid-cols-3">
              {STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-4 md:flex-col md:gap-3">
                  <span
                    className="font-display text-primary tabular text-4xl leading-none font-bold"
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="text-xl font-semibold">{step.title}</h3>
                    <p className="text-muted-foreground mt-1.5 max-w-[42ch] leading-relaxed">{step.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Section>

          <Section id="features" title="Built for both sides of the invite">
            <div className="grid gap-10 md:grid-cols-2">
              <FeatureList heading="For you, the host" items={FOR_HOSTS} />
              <FeatureList heading="For your guests" items={FOR_GUESTS} />
            </div>

            <div className="bg-card mt-12 rounded-2xl border p-6 sm:p-8">
              <h3 className="text-xl font-semibold">Coming next</h3>
              <p className="text-muted-foreground mt-1 text-sm">On the roadmap, not built yet.</p>
              <ul className="mt-5 grid gap-x-8 gap-y-4 sm:grid-cols-2">
                {COMING.map((item) => (
                  <li key={item.title} className="flex gap-3">
                    <span
                      aria-hidden
                      className="border-muted-foreground/60 mt-1.5 size-2.5 shrink-0 rounded-full border-[1.5px]"
                    />
                    <div>
                      <p className="font-medium">{item.title}</p>
                      <p className="text-muted-foreground text-sm leading-relaxed">{item.body}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </Section>

          <Section id="under-the-hood" title="Under the hood">
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <p className="text-muted-foreground max-w-[52ch] leading-relaxed">
                  A rebuild of a university group project, done solo, with the hard parts done properly.
                </p>
                <dl className="mt-8 flex flex-col gap-6">
                  {ENGINEERING.map((item) => (
                    <div key={item.title}>
                      <dt className="text-lg font-semibold">{item.title}</dt>
                      <dd className="text-muted-foreground mt-1 max-w-[56ch] leading-relaxed">{item.body}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              <figure>
                <pre className="bg-card overflow-x-auto rounded-xl border p-5 text-[13px] leading-relaxed">
                  <code>{CONSTRAINT_SQL}</code>
                </pre>
                <figcaption className="text-muted-foreground mt-3 max-w-[56ch] text-sm leading-relaxed">
                  The last line of defence. Two confirmed bookings for the same host can&apos;t overlap,
                  whatever the app code does. Cancelled bookings don&apos;t count, so cancelling frees the
                  time.
                </figcaption>
                <p className="mt-8 max-w-[56ch] text-sm leading-relaxed">
                  Built with Next.js 16, TypeScript, PostgreSQL on Neon, Drizzle ORM, Better Auth, React Email
                  and Resend.{" "}
                  <a href={REPO_URL} className="font-medium underline underline-offset-4">
                    Read the code on GitHub
                  </a>
                  .
                </p>
              </figure>
            </div>
          </Section>

          <Section id="faq" title="Questions">
            <div className="divide-y border-y">
              {FAQ.map((item) => (
                <details key={item.q} className="group">
                  <summary className="hover:text-foreground flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-lg font-medium [&::-webkit-details-marker]:hidden">
                    {item.q}
                    <ChevronDown
                      aria-hidden
                      className="text-muted-foreground size-5 shrink-0 transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <p className="text-muted-foreground max-w-[64ch] pb-5 leading-relaxed">{item.a}</p>
                </details>
              ))}
            </div>
          </Section>

          <section className="mx-auto max-w-6xl px-5 pb-20 sm:px-8">
            <div className="bg-primary text-primary-foreground flex flex-col items-start gap-6 rounded-3xl px-6 py-12 sm:px-12 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-3xl font-bold sm:text-4xl">Your hours, their day, no maths.</h2>
                <p className="text-primary-foreground/75 mt-2 max-w-[48ch]">
                  Sign in with Google, pick your link, and it&apos;s ready to share in about a minute.
                </p>
              </div>
              <Button
                asChild
                size="lg"
                className="bg-primary-foreground text-primary hover:bg-primary-foreground/90 shrink-0"
              >
                <Link href="/login">Create your booking page</Link>
              </Button>
            </div>
          </section>
        </main>
      </PageTransition>

      <SiteFooter />
    </div>
  );
}

function Section({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-heading`} className="scroll-mt-20 border-t">
      <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-20">
        <h2 id={`${id}-heading`} className="text-3xl font-bold sm:text-4xl">
          {title}
        </h2>
        {intro && <p className="text-muted-foreground mt-2 max-w-[56ch] text-lg">{intro}</p>}
        <div className="mt-10">{children}</div>
      </div>
    </section>
  );
}

function FeatureList({ heading, items }: { heading: string; items: { title: string; body: string }[] }) {
  return (
    <div>
      <h3 className="text-xl font-semibold">{heading}</h3>
      <ul className="mt-5 flex flex-col gap-5">
        {items.map((item) => (
          <li key={item.title} className="flex gap-3">
            <Check aria-hidden className="text-primary mt-0.5 size-5 shrink-0" />
            <div>
              <p className="font-medium">{item.title}</p>
              <p className="text-muted-foreground text-sm leading-relaxed">{item.body}</p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STEPS = [
  { title: "Set your hours", body: "Weekly hours in your own timezone, plus days off and one-off changes." },
  {
    title: "Share your link",
    body: "One link per kind of meeting: a 30-minute intro, an hour-long interview.",
  },
  {
    title: "Guests pick a time in theirs",
    body: "Both of you get an email with a calendar invite. Guests can reschedule or cancel from a private link in theirs.",
  },
];

const FOR_HOSTS = [
  {
    title: "Hours set once, in your timezone",
    body: "A weekly schedule with several ranges a day, plus date overrides for holidays and one-off hours.",
  },
  {
    title: "Rules that protect your day",
    body: "Buffers before and after, minimum notice, how far ahead people can book, and a daily limit.",
  },
  {
    title: "As many meeting types as you need",
    body: "Each with its own length, location (Google Meet, Zoom, phone, in person), colour and link.",
  },
  {
    title: "Your week at a glance",
    body: "Seven days of working hours and booked meetings, then upcoming, past and cancelled bookings.",
  },
];

const FOR_GUESTS = [
  {
    title: "No account, no sign-up",
    body: "Open the link, pick a time, enter a name and email. That's it.",
  },
  {
    title: "Times in their timezone, detected automatically",
    body: "With the host's time beside every slot and a daylight band showing if it's 3 AM for them.",
  },
  {
    title: "A real calendar invite",
    body: "Confirmation emails carry an .ics file that updates or removes the event when plans change.",
  },
  {
    title: "Change of plans in two clicks",
    body: "Reschedule or cancel from the private link in their email. The host is told straight away.",
  },
];

const COMING = [
  { title: "Google Calendar sync", body: "Your other events block times, and bookings get a Meet link." },
  { title: "Reminder emails", body: "A day before and an hour before each meeting." },
  { title: "Booking questions", body: "Ask guests what the meeting is about, with your own fields." },
  {
    title: "AI booking assistant",
    body: "“30 minutes next Tuesday afternoon, I'm in London”, then confirm.",
  },
  {
    title: "Book from Claude or ChatGPT",
    body: "An MCP server so AI assistants can check your times and book.",
  },
  { title: "Analytics and embeds", body: "Booking trends, no-shows, and a widget for your own website." },
];

const ENGINEERING = [
  {
    title: "Double booking is impossible, not just unlikely",
    body: "Bookings for the same host take turns behind a database lock and re-check the time first, so the slower guest gets a clear “just taken” message. Underneath, Postgres itself refuses overlaps. Tests fire simultaneous bookings at a real database to prove it.",
  },
  {
    title: "Timezones and daylight saving, handled",
    body: "Working hours are stored as local times and converted date by date, so 9 AM stays 9 AM when the clocks change. 23- and 25-hour days have their own tests.",
  },
  {
    title: "Private links that can’t be guessed",
    body: "Each guest’s manage link carries 256 random bits, and the database stores only a hash of it. The page is never indexed and sends no referrer.",
  },
  {
    title: "Tested where it matters",
    body: "Over 250 tests. Slot generation is a pure function tested on its own, and CI runs the race tests against real Postgres.",
  },
];

const FAQ = [
  {
    q: "Do my guests need an account?",
    a: "No. Guests open your link, pick a time and enter their name and email. Only hosts sign in, with Google.",
  },
  {
    q: "How does it know my guest's timezone?",
    a: "From their browser, the same way their computer's clock knows. They can switch it on the booking page if they're travelling or booking for someone else.",
  },
  {
    q: "What if two people try to book the same time?",
    a: "One gets it, the other is told it was just taken and picks another time. This is enforced by the database itself, not just the app, and tested with simultaneous bookings.",
  },
  {
    q: "What happens when the clocks change for daylight saving?",
    a: "Your hours are stored as local times (9:00–17:00 in your city) and converted for each date, so a 9 AM start stays 9 AM for you after the change, and guests see the right time for them.",
  },
  {
    q: "Can guests reschedule or cancel?",
    a: "Yes, from a private link in their confirmation email. Both of you get an updated calendar invite.",
  },
  {
    q: "Does it connect to Google Calendar?",
    a: "Not yet: it's next on the roadmap. Today, every booking arrives as an email with a calendar invite you can add in one click.",
  },
];

const CONSTRAINT_SQL = `ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
    host_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status = 'confirmed');`;
