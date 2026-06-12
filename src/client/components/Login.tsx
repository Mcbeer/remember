import { Button } from "@/components/ui/button.tsx";

export function Login({ returnTo }: { returnTo?: string }) {
  // Carry an intended path (e.g. /join/<secret>) through the OAuth round-trip.
  const href = returnTo
    ? `/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`
    : "/api/auth/google";

  return (
    <div className="grid min-h-full place-items-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <h1 className="text-2xl font-semibold tracking-tight">Remember</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Shared lists for your family.
        </p>
        <Button asChild className="mt-6 w-full" size="lg">
          <a href={href}>Sign in with Google</a>
        </Button>
      </div>
    </div>
  );
}
