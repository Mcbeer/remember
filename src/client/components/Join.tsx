import { useEffect, useState } from "react";
import { useAcceptInvite } from "../hooks.ts";
import { Button } from "@/components/ui/button.tsx";

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
    <div className="grid min-h-full place-items-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-xl font-semibold tracking-tight">Join family</h1>
        {error ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">{error}</p>
            <Button variant="outline" className="mt-6 w-full" onClick={goHome}>
              Go to app
            </Button>
          </>
        ) : done ? (
          <>
            <p className="mt-2 text-sm text-muted-foreground">You're in!</p>
            <Button className="mt-6 w-full" onClick={goHome}>
              Open app
            </Button>
          </>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">Joining…</p>
        )}
      </div>
    </div>
  );
}
