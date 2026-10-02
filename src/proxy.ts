import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * This is an *optimistic* check only, not the security boundary.
 *
 * Clerk deprecated `createRouteMatcher` because Middleware-level gating can be
 * bypassed entirely (path-matching divergences, and documented cases where a
 * request never reaches Middleware at all). The real gates are at the
 * resources: `requireAuth` in the dashboard layout and page, and `withAuth` in
 * every API route.
 *
 * So this only sends signed-out visitors to sign-in sooner. Deleting this would
 * not expose anything — it would just make them wait for the layout to redirect.
 */
const PROTECTED_PREFIX = "/dashboard";

export default clerkMiddleware(async (auth, req) => {
  const pathname = req.nextUrl.pathname;
  if (
    pathname === PROTECTED_PREFIX ||
    pathname.startsWith(`${PROTECTED_PREFIX}/`)
  ) {
    const { isAuthenticated, redirectToSignIn } = await auth();
    if (!isAuthenticated) return redirectToSignIn();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};