/** Match the browser origin to the request Host, which survives Next's internal URL rewrite. */
export function sameOrigin(request: Request): boolean {
  const raw = request.headers.get("origin");
  if (!raw) return false;
  try {
    const origin = new URL(raw);
    const host = request.headers.get("host") ?? new URL(request.url).host;
    return (origin.protocol === "https:" || origin.protocol === "http:") &&
      origin.origin === raw && origin.host === host.toLowerCase();
  } catch { return false; }
}
