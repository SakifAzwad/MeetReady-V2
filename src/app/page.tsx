import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col justify-center gap-4 p-8">
      <h1 className="text-4xl font-semibold tracking-tight">MeetReady</h1>
      <p className="text-lg text-neutral-600 dark:text-neutral-400">
        Scheduling without the back-and-forth. Share a link, guests pick a time that works in their timezone.
      </p>
      <Link
        href="/dashboard"
        className="mt-4 self-start rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700"
      >
        Get started
      </Link>
    </main>
  );
}
