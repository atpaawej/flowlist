import "server-only";
import { cache } from "react";
import { auth } from "@clerk/nextjs/server";

/**
 * The authentication gate for anything server-rendered.
 *
 * `auth.protect()` throws a redirect for unauthenticated document requests and
 * a 401 for non-document ones, which is what we want in both cases: a
 * signed-out visitor to /dashboard should land on sign-in, and anything that
 * isn't a page request should get a status rather than a redirect.
 *
 * Wrapped in React's `cache` so the page, its layout, and any component that
 * calls it during one render resolve the session a single time.
 *
 * Proxy is an optimistic check, not the security boundary — the API routes
 * enforce their own session check in `withAuth`. This is the resource-level
 * half of that pair.
 */
export const requireAuth = cache(async () => {
  await auth.protect();
});