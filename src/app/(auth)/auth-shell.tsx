import Link from "next/link";
import { Wordmark } from "@/components/wordmark";

/**
 * Shared shell for sign-in and sign-up. Both routes differ only in their
 * heading — everything else is identical, so it lives here.
 *
 * The account switch inside the Clerk card handles "need the other flow?",
 * so this shell doesn't repeat it.
 */
export function AuthShell({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="px-6 py-6">
        <div className="mx-auto w-full max-w-[1080px]">
          <Wordmark className="text-[15px]" />
        </div>
      </header>

      <main className="flex flex-1 items-start justify-center px-6 pb-24 pt-8 sm:pt-16">
        <div className="w-full max-w-[360px]">
          <div className="animate-settle-in">
            <h1 className="text-[22px] font-medium tracking-display text-ink">
              {title}
            </h1>
            <p className="mt-2 text-[14px] leading-[1.6] text-ink-2">
              {description}
            </p>
          </div>

          <div
            className="animate-settle-in mt-8"
            style={{ animationDelay: "80ms" }}
          >
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}