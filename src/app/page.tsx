import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { ButtonLink } from "@/components/button";
import { Kbd } from "@/components/kbd";
import { Wordmark } from "@/components/wordmark";

const SHORTCUTS = [
  { keys: ["n"], label: "New task" },
  { keys: ["j", "k"], label: "Move the selection" },
  { keys: ["x"], label: "Complete or reopen" },
  { keys: ["e"], label: "Edit" },
  { keys: ["d"], label: "Delete" },
  { keys: ["Esc"], label: "Close" },
];

export default async function LandingPage() {
  const { userId } = await auth();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-50 border-b border-line bg-void/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-[1080px] items-center justify-between px-6">
          <Wordmark className="text-[15px]" />
          <nav className="flex items-center gap-1">
            {userId ? (
              <Link
                href="/dashboard"
                className="inline-flex h-8 items-center rounded-notch px-3 text-[13px] font-medium text-ink transition-colors duration-150 hover:bg-raised"
              >
                Your tasks
              </Link>
            ) : (
              <>
                <Link
                  href="/sign-in"
                  className="inline-flex h-8 items-center rounded-notch px-3 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:bg-raised hover:text-ink"
                >
                  Sign in
                </Link>
                <Link
                  href="/sign-up"
                  className="inline-flex h-8 items-center rounded-notch bg-ink px-3.5 text-[13px] font-medium text-void transition-colors duration-150 hover:bg-ink/85"
                >
                  Create account
                </Link>
              </>
            )}
          </nav>
        </div>
        <div
          aria-hidden
          className="animate-drain absolute inset-x-0 bottom-0 h-px bg-line-strong"
        />
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto w-full max-w-[1080px] px-6 pt-24 pb-20 sm:pt-32 sm:pb-28">
          <div className="max-w-[760px]">
            <h1
              className="text-hero animate-settle-in text-[clamp(2.75rem,7vw,5rem)] font-medium text-ink"
              style={{ animationDelay: "120ms" }}
            >
              Your hands never
              <br />
              leave the keyboard.
            </h1>
            <p
              className="animate-settle-in mt-7 max-w-[52ch] text-[17px] leading-[1.6] text-ink-2"
              style={{ animationDelay: "220ms" }}
            >
              Flowlist is a task list driven by j, k, x, e and d. No dragging.
              No menus. Open it, clear your inbox, close it.
            </p>
            <div
              className="animate-settle-in mt-9 flex flex-wrap items-center gap-3"
              style={{ animationDelay: "320ms" }}
            >
              {userId ? (
                <ButtonLink href="/dashboard">Open your tasks</ButtonLink>
              ) : (
                <>
                  <ButtonLink href="/sign-up">Create account</ButtonLink>
                  <ButtonLink href="/sign-in" variant="secondary">
                    Sign in
                  </ButtonLink>
                </>
              )}
            </div>
          </div>
        </section>

        {/* Shortcuts — the real table of contents */}
        <section className="border-t border-line">
          <div className="mx-auto grid w-full max-w-[1080px] grid-cols-1 gap-12 px-6 py-20 md:grid-cols-[1fr_1fr] md:gap-24 md:py-28">
            <div>
              <h2 className="max-w-[18ch] text-[clamp(1.5rem,3vw,2rem)] font-medium tracking-display text-ink">
                Six keys do everything.
              </h2>
              <p className="mt-4 max-w-[38ch] text-[15px] leading-[1.65] text-ink-2">
                The cursor remembers where you left it, so you can go from
                reading a task to editing it without reaching for the mouse.
              </p>
            </div>

            <dl className="divide-y divide-line border-t border-line">
              {SHORTCUTS.map(({ keys, label }) => (
                <div
                  key={label}
                  className="flex items-center justify-between gap-6 py-3.5"
                >
                  <dt className="text-[14px] text-ink-2">{label}</dt>
                  <dd className="flex shrink-0 items-center gap-1">
                    {keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* What it holds */}
        <section className="border-t border-line">
          <div className="mx-auto w-full max-w-[1080px] px-6 py-20 md:py-24">
            <div className="grid grid-cols-1 gap-12 md:grid-cols-3 md:gap-16">
              {[
                {
                  title: "Order you control",
                  body: "Drag a task to move it, or pick it up and press a key. Either way the order sticks.",
                },
                {
                  title: "Tags that mean something",
                  body: "Group work by project, not by a colour you have to remember. Filter down to one list.",
                },
                {
                  title: "Due dates and priority",
                  body: "Set both when it matters. Past-due work is the only thing that turns red.",
                },
              ].map(({ title, body }) => (
                <div key={title}>
                  <h3 className="text-[15px] font-medium text-ink">{title}</h3>
                  <p className="mt-2.5 text-[14px] leading-[1.6] text-ink-2">
                    {body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-[1080px] flex-col gap-6 px-6 py-12 md:flex-row md:items-center md:justify-between">
          <Wordmark className="text-[13px] text-ink-2" />
          <div className="flex items-center gap-6 text-[13px] text-ink-3">
            <Link
              href="/sign-in"
              className="transition-colors duration-150 hover:text-ink"
            >
              Sign in
            </Link>
            <Link
              href="/sign-up"
              className="transition-colors duration-150 hover:text-ink"
            >
              Create account
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}