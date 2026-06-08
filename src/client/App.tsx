import { useMe } from "./hooks.ts";
import { ApiError } from "./api.ts";
import { Login } from "./components/Login.tsx";
import { Home } from "./components/Home.tsx";
import { Join } from "./components/Join.tsx";

const JOIN_PREFIX = "/join/";

function joinSecret(): string | null {
  const path = window.location.pathname;
  if (path.startsWith(JOIN_PREFIX)) {
    const secret = path.slice(JOIN_PREFIX.length).split("/")[0];
    return secret || null;
  }
  return null;
}

export function App() {
  const me = useMe();
  const secret = joinSecret();

  if (me.isLoading) {
    return <div className="centered muted">Loading…</div>;
  }

  const notLoggedIn =
    (me.isError && me.error instanceof ApiError && me.error.status === 401) ||
    !me.data;

  if (notLoggedIn) {
    // Preserve a /join target across the OAuth round-trip so the invite
    // resumes after login.
    return <Login returnTo={secret ? window.location.pathname : undefined} />;
  }

  if (secret) {
    return <Join secret={secret} />;
  }

  return <Home me={me.data} />;
}
