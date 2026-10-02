"use client";

import { useUser } from "@clerk/nextjs";

/**
 * The greeting. Time-aware rather than a fixed "Welcome back" — the whole
 * point is that you can read it in one glance and know which day it is.
 */
export function AppHeader() {
  const { user } = useUser();
  const firstName = user?.firstName;

  const now = new Date();
  const greeting =
    now.getHours() < 12
      ? "Good morning"
      : now.getHours() < 18
        ? "Good afternoon"
        : "Good evening";

  const date = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(now);

  return (
    <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-line pb-6">
      <div>
        <p className="text-[13px] text-ink-3">{date}</p>
        <h1 className="mt-1.5 text-[clamp(1.5rem,4vw,1.875rem)] font-medium tracking-display text-ink">
          {firstName ? `${greeting}, ${firstName}` : greeting}
        </h1>
      </div>
    </div>
  );
}