import type { NextConfig } from "next";

const dev = process.env.NODE_ENV !== "production";
const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin : "";

/**
 * Content Security Policy. Videos come only from YouTube's privacy-enhanced embed, images only
 * from YouTube and GitHub avatars, and nobody may frame Vouch (clickjacking). Sign-in redirects
 * go through Supabase to GitHub or Google, so those are allowed form targets.
 * Inline scripts stay allowed: Next.js streams inline bootstrap scripts, and nonces would make
 * every page dynamic.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://www.youtube.com https://s.ytimg.com${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://i.ytimg.com https://avatars.githubusercontent.com",
  "font-src 'self' data:",
  "frame-src https://www.youtube-nocookie.com",
  `connect-src 'self'${supabase ? ` ${supabase}` : ""}${dev ? " ws: wss:" : ""}`,
  `form-action 'self'${supabase ? ` ${supabase}` : ""} https://github.com https://accounts.google.com`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  ...(dev ? [] : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
];

const nextConfig: NextConfig = {
  // No Next.js "N" badge in development; build and runtime errors still show.
  devIndicators: false,
  cacheComponents: true,
  partialPrefetching: true,
  // PGlite ships WASM + data files that must be loaded from node_modules, not bundled.
  serverExternalPackages: ["@electric-sql/pglite"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "avatars.githubusercontent.com" },
    ],
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
