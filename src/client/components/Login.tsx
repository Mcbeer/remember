export function Login({ returnTo }: { returnTo?: string }) {
  // Carry an intended path (e.g. /join/<secret>) through the OAuth round-trip.
  const href = returnTo
    ? `/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`
    : "/api/auth/google";

  return (
    <div className="centered">
      <div className="login-card">
        <h1>Remember</h1>
        <p className="muted">Shared lists for your family.</p>
        <a className="btn btn-primary" href={href}>
          Sign in with Google
        </a>
      </div>
    </div>
  );
}
