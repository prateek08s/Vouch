"use client";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="empty" role="alert">
      <p><strong>Something went wrong on our side.</strong></p>
      <p className="trust-tag">{error.digest ? `Reference: ${error.digest}` : error.message}</p>
      {retry && (
        <button className="button" onClick={() => retry()}>Try again</button>
      )}
    </div>
  );
}
