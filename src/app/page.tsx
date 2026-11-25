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
 *   what's next, labelled honestly) → where does AI come in → can I trust it
 *   (under the hood) → FAQ.
 * Day 28 review: the copy had fallen behind (Google Calendar, reminders, AI,
 * MCP and the embed were still "coming next"). When a feature ships, update
 * FOR_HOSTS / FOR_GUESTS / AI_FEATURES / COMING and the FAQ in the same change.
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
                  Share one link. Guests see your working hours laid over their own day, or just say when
                  suits them, and you each get it on your own clock.
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

          <Section
            id="ai"
            title="AI where it helps, with guardrails"
            intro="Three features, each built so the model can't book on its own or make up a time."
          >
            <ul className="grid gap-5 md:grid-cols-3">
              {AI_FEATURES.map((item) => (
                <li key={item.title} className="bg-card flex flex-col gap-3 rounded-2xl border p-6">
                  <h3 className="text-xl font-semibold">{item.title}</h3>
                  <p className="text-muted-foreground leading-relaxed">{item.body}</p>
                  <p className="mt-auto border-t pt-3 text-sm leading-relaxed">
                    <span className="font-medium">Guardrail: </span>
                    {item.guardrail}
                  </p>
                </li>
              ))}
            </ul>
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
                  Built with Next.js 16, TypeScript, PostgreSQL on Neon, Drizzle ORM, Better Auth, Inngest,
                  Upstash Redis, the Vercel AI SDK with Groq, the MCP SDK, React Email, Resend and Sentry.{" "}
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
  {
    title: "Set your hours",
    body: "Weekly hours in your own timezone, plus days off and one-off changes. Connect Google Calendar and your other events block times.",
  },
  {
    title: "Share your link",
    body: "One link per kind of meeting: a 30-minute intro, an hour-long interview. Or put the calendar on your own website.",
  },
  {
    title: "Guests pick a time in theirs",
    body: "It lands in your Google Calendar with a Meet link, and both of you get an email. Guests get reminders, and can reschedule or cancel from a private link.",
  },
];

const FOR_HOSTS = [
  {
    title: "Hours set once, in your timezone",
    body: "A weekly schedule with several ranges a day, plus date overrides for holidays and one-off hours.",
  },
  {
    title: "Your Google Calendar, both ways",
    body: "Busy events block times, and each booking is added to your calendar with a Google Meet link.",
  },
  {
    title: "Rules that protect your day",
    body: "Buffers before and after, minimum notice, how far ahead people can book, and a daily limit.",
  },
  {
    title: "Meeting types with your own questions",
    body: "Each with its own length, location (Google Meet, Zoom, phone, in person), colour, link and booking questions.",
  },
  {
    title: "Your week, and how it's going",
    body: "Seven days at a glance, upcoming and past bookings, a Move button, no-shows, and Insights on held, missed and cancelled meetings.",
  },
  {
    title: "Meetings with your whole team",
    body: "Create a team, invite people with a link, and share one page that offers only the times when everyone on it is free. Every host sees the meeting on their dashboard and gets it in Google Calendar, and any of them can move it.",
  },
  {
    title: "On your website and in your tools",
    body: "Embed the calendar inline or as a popup, and send signed webhooks to Zapier, Slack or your CRM when bookings change.",
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
    title: "Or just say when suits them",
    body: "“Tuesday afternoon, I'm in London” finds real free times, on their clock.",
  },
  {
    title: "A real calendar invite, and reminders",
    body: "Confirmation emails carry an .ics file that updates when plans change, and reminders arrive a day and an hour before.",
  },
  {
    title: "Change of plans in two clicks",
    body: "Reschedule or cancel from the private link in their emails. The host's calendar updates by itself.",
  },
  {
    title: "Easy on the eyes",
    body: "Light or dark, following their device or their choice, and laid out for a phone as much as a laptop.",
  },
];

const AI_FEATURES = [
  {
    title: "Tell us when suits you",
    body: "A guest types “next week, a morning, I'm in London” and gets three real free times to pick from, in their language.",
    guardrail:
      "the model only fills in a search. Code checks it and finds the times; every suggestion comes from the host's calendar, and the guest still confirms in the form.",
  },
  {
    title: "A brief before each meeting",
    body: "From the guest's notes and answers, a short summary and agenda in the host's email and on the Bookings page.",
    guardrail:
      "the guest's text is fenced off as data and the model has no tools. Its reply must match a schema, is cleaned in code before anyone sees it, and is labelled as written by AI.",
  },
  {
    title: "Book from Claude",
    body: "Connect MeetReady to Claude (or any MCP client) and ask “what's my week?”, or have it book, move or cancel a meeting.",
    guardrail:
      "the host approves the connection on MeetReady's own consent page. Each change needs a confirm step (MeetReady's own form where the assistant supports it), and Disconnect works at once.",
  },
];

const COMING = [
  {
    title: "Round-robin",
    body: "Bookings shared fairly across a team: the next one goes to whoever had the fewest lately.",
  },
  {
    title: "Hold a time while the guest types",
    body: "A few minutes' hold on the picked time, so nobody takes it halfway through the form.",
  },
  {
    title: "Preferred hours",
    body: "Times you'd rather have shown first, without closing the rest.",
  },
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
    title: "AI that can't invent a time or act alone",
    body: "Models write searches and text; code does the date maths, checks every answer and decides what's shown. Guests' words are sent only where a feature needs them, to a provider that doesn't train on them.",
  },
  {
    title: "Its own OAuth server for AI assistants",
    body: "The MCP server signs assistants in with OAuth 2.1: PKCE, tokens bound to MeetReady, refresh tokens that rotate, and a consent page that lists what each one may do.",
  },
  {
    title: "Private links that can’t be guessed",
    body: "Guests’ manage links and team invites carry 256 random bits, and the database stores only a hash. Those pages are never indexed and send no referrer.",
  },
  {
    title: "Tested where it matters",
    body: "800+ unit tests and 50+ browser tests run in CI. The browser tests use the production build and real Postgres, with fake Google and Groq servers; evals check the AI on the real model.",
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
    q: "Does it connect to Google Calendar?",
    a: "Yes. Your busy times block slots (MeetReady asks Google only whether you're busy, never what the events are), and each booking is added to your calendar with a Google Meet link.",
  },
  {
    q: "Can guests reschedule or cancel?",
    a: "Yes, from a private link in their confirmation and reminder emails. Your Google Calendar updates by itself, and they get an updated invite.",
  },
  {
    q: "What does the AI see?",
    a: "Only what each feature needs. For the brief: the guest's first name, the meeting type, and their notes and answers. For finding a time: what the guest typed and their timezone. It runs on Groq, which doesn't train on it. Without AI everything else still works.",
  },
  {
    q: "Can I put it on my own website?",
    a: "Yes. Event types → Embed gives you a short snippet: the calendar inside your page, or a link that opens it as a popup. Your site is told when someone books, without their details.",
  },
  {
    q: "Can my team use it?",
    a: "Yes. Create a team from your account menu, invite people with a link, and add team event types: guests see only the times when every host you picked is free, and the meeting is with all of them. It's one event in the organizer's Google Calendar with the other hosts invited, it's on every host's Bookings page and Insights, and any host (or the guest) can move or cancel it. Round-robin (one host per meeting, shared fairly) is next.",
  },
];

const CONSTRAINT_SQL = `ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
    host_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status = 'confirmed');`;
