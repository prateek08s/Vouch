import type { Instrumentation } from "next";

/**
 * Every server error, as one structured log line: Vercel's log search and alerts can filter on
 * "vouch_error". To send errors to Sentry, install @sentry/nextjs and call
 * Sentry.captureRequestError(err, request, context) here.
 */
export const onRequestError: Instrumentation.onRequestError = async (err, request, context) => {
  const e = err as Error & { digest?: string };
  console.error(
    JSON.stringify({
      event: "vouch_error",
      message: e.message,
      digest: e.digest ?? null,
      path: request.path,
      method: request.method,
      route: context.routePath,
      routeType: context.routeType,
      at: new Date().toISOString(),
    }),
  );
};
