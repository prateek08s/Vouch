/**
 * Vouch's mark: a highlighter-yellow tile with an opening quotation mark in signature ink.
 * The quote is what someone said; the highlighter is why it's worth hearing.
 */
export function LogoMark({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="15" fill="#ffd84d" />
      <path
        transform="translate(-1.5 3.5)"
        fill="var(--logo-ink, #1f3bb3)"
        d="M29.4 13.8c-8.6 2.9-14.4 10-14.4 19.3 0 6.5 3.7 10.7 9.1 10.7 4.6 0 8-3.4 8-7.8 0-4.3-3-7.4-7-7.7 1-4.1 4.2-7.3 8.6-9.2l-4.3-5.3zm19.9 0c-8.6 2.9-14.4 10-14.4 19.3 0 6.5 3.7 10.7 9.1 10.7 4.6 0 8-3.4 8-7.8 0-4.3-3-7.4-7-7.7 1-4.1 4.2-7.3 8.6-9.2l-4.3-5.3z"
      />
    </svg>
  );
}
