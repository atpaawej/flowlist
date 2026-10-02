import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { Wordmark } from "@/components/wordmark";
import { requireAuth } from "@/lib/auth-dal";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  await requireAuth();

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-50 border-b border-line bg-void/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-[720px] items-center justify-between px-5 sm:px-6">
          <Wordmark className="text-[15px]" />
          <div className="flex items-center gap-1">
            <Link
              href="/"
              className="inline-flex h-8 items-center rounded-notch px-3 text-[13px] font-medium text-ink-2 transition-colors duration-150 hover:bg-raised hover:text-ink"
            >
              Home
            </Link>
            <UserButton />
          </div>
        </div>
        <div
          aria-hidden
          className="animate-drain absolute inset-x-0 bottom-0 h-px bg-line-strong"
        />
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}