"use client";

export default function ErrorPage({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="empty" role="alert">
      <strong>This page didn’t load.</strong>
      <p>Something failed on the server. Try again; if it keeps happening, share the reference below.</p>
      <p className="muted">{error.digest ? `Reference: ${error.digest}` : error.message}</p>
      {retry && (
        <div className="actions">
          <button className="button" onClick={() => retry()}>Try again</button>
        </div>
      )}
    </div>
  );
}
