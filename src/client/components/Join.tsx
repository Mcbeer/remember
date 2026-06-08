import { useEffect, useState } from "react";
import { useAcceptInvite } from "../hooks.ts";

// Handles /join/:secret. The User must be logged in (App guarantees this before
// rendering Join); on accept we send them to the app.
export function Join({ secret }: { secret: string }) {
  const accept = useAcceptInvite();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    accept
      .mutateAsync(secret)
      .then(() => {
        if (!cancelled) setDone(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
    // run once for this secret
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secret]);

  function goHome() {
    window.history.replaceState({}, "", "/");
    window.location.reload();
  }

  return (
    <div className="centered">
      <div className="login-card">
        <h1>Join family</h1>
        {error ? (
          <>
            <p className="muted">{error}</p>
            <button className="btn" onClick={goHome}>
              Go to app
            </button>
          </>
        ) : done ? (
          <>
            <p className="muted">You're in!</p>
            <button className="btn btn-primary" onClick={goHome}>
              Open app
            </button>
          </>
        ) : (
          <p className="muted">Joining…</p>
        )}
      </div>
    </div>
  );
}
