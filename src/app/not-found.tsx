import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { Band, BandTicks } from "@/components/daylight/band";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Page not found" };

/*
 * Shown for unknown URLs and for notFound() (unknown host, switched-off
 * event type, bad manage link). The visual is the band with nothing on it:
 * a whole day with no hours, nothing to book.
 */
export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col px-6 py-8 sm:px-12">
      <Link href="/" aria-label="MeetReady home" className="self-start rounded-md">
        <Logo />
      </Link>
      <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-6 py-16">
        <div className="flex flex-col gap-2" aria-hidden>
          <Band segments={[]} />
          <BandTicks />
        </div>
        <div>
          <h1 className="text-4xl font-bold">This page could not be found.</h1>
          <p className="text-muted-foreground mt-3 leading-relaxed">
            The link may be mistyped, or the page was removed. If someone sent you a booking link, check with
            them that it&apos;s still active.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/">Go to the home page</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/dashboard">Open your dashboard</Link>
          </Button>
        </div>
      </div>
    </main>
  );
}
