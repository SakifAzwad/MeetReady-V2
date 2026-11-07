import Link from "next/link";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { HeroBands } from "./_landing/hero-bands";

const REPO = "https://github.com/SakifAzwad/MeetReady-V2";

/*
 * One bold element (the two-band demo); everything else stays quiet.
 * The page talks to two readers: people who might use it (hero, how it
 * works) and engineers reviewing the project (the engineering section).
 */
export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-5 sm:px-8">
        <Link href="/" className="font-display text-xl font-bold tracking-tight">
          MeetReady
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 text-sm sm:gap-2">
          <a href="#how-it-works" className="hover:bg-accent hidden rounded-md px-3 py-2 sm:block">
            How it works
          </a>
          <a href="#engineering" className="hover:bg-accent hidden rounded-md px-3 py-2 sm:block">
            Under the hood
          </a>
          <a href={REPO} className="hover:bg-accent hidden rounded-md px-3 py-2 sm:block">
            GitHub
          </a>
          <Button asChild variant="outline" size="sm">
            <Link href="/login">Log in</Link>
          </Button>
        </nav>
      </header>

      <main className="flex-1">
        <section className="mx-auto max-w-6xl px-5 pt-10 pb-16 sm:px-8 sm:pt-16">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-end">
            <h1 className="text-[clamp(2.5rem,6vw,4.5rem)] leading-[1.02] font-bold text-balance">
              Meetings across timezones, without the maths.
            </h1>
            <div className="flex flex-col gap-5 lg:pb-2">
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

          <div className="mt-12">
            <HeroBands />
          </div>
        </section>

        <section id="how-it-works" className="border-t">
          <div className="mx-auto max-w-6xl px-5 py-16 sm:px-8">
            <h2 className="text-3xl font-bold">How it works</h2>
            <ol className="mt-8 grid gap-8 md:grid-cols-3">
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
          </div>
        </section>

        <section id="engineering" className="border-t">
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-5 py-16 sm:px-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div>
              <h2 className="text-3xl font-bold">Under the hood</h2>
              <p className="text-muted-foreground mt-3 max-w-[52ch] leading-relaxed">
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

            <figure className="lg:pt-14">
              <pre className="bg-card overflow-x-auto rounded-xl border p-5 text-[13px] leading-relaxed">
                <code>{CONSTRAINT_SQL}</code>
              </pre>
              <figcaption className="text-muted-foreground mt-3 max-w-[56ch] text-sm leading-relaxed">
                The last line of defence. Two confirmed bookings for the same host can&apos;t overlap,
                whatever the app code does. Cancelled bookings don&apos;t count, so cancelling frees the time.
              </figcaption>
              <p className="mt-8 max-w-[56ch] text-sm leading-relaxed">
                Built with Next.js 16, TypeScript, PostgreSQL on Neon, Drizzle ORM, Better Auth, React Email
                and Resend.{" "}
                <a href={REPO} className="font-medium underline underline-offset-4">
                  Read the code on GitHub
                </a>
                .
              </p>
            </figure>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="text-muted-foreground mx-auto flex max-w-6xl flex-wrap justify-between gap-2 px-5 py-6 text-sm sm:px-8">
          <span>MeetReady v2, rebuilt by Sakif Azwad from the original team project.</span>
          <a href={REPO} className="hover:text-foreground underline underline-offset-4">
            Source on GitHub
          </a>
        </div>
      </footer>
    </div>
  );
}

const STEPS = [
  {
    title: "Set your hours",
    body: "Weekly hours in your own timezone, plus days off and one-off changes.",
  },
  {
    title: "Share your link",
    body: "One link per kind of meeting: a 30-minute intro, an hour-long interview.",
  },
  {
    title: "Guests pick a time in theirs",
    body: "Both of you get an email with a calendar invite. Guests can reschedule or cancel from a private link in theirs.",
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
    title: "Private links that can’t be guessed",
    body: "Each guest’s manage link carries 256 random bits, and the database stores only a hash of it. The page is never indexed and sends no referrer.",
  },
  {
    title: "Tested where it matters",
    body: "Over 250 tests. Slot generation is a pure function tested on its own, and CI runs the race tests against real Postgres.",
  },
];

const CONSTRAINT_SQL = `ALTER TABLE bookings
  ADD CONSTRAINT bookings_no_overlap
  EXCLUDE USING gist (
    host_id WITH =,
    tstzrange(starts_at, ends_at, '[)') WITH &&
  )
  WHERE (status = 'confirmed');`;
