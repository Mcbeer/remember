import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { createDb } from "../db/index.ts";
import { validateSessionToken, type SessionUser } from "./session.ts";
import { SESSION_COOKIE, clearSessionCookie } from "./cookies.ts";

// Context variables set by the auth middleware. `user` is null when not logged in.
export type AuthVariables = {
  user: SessionUser | null;
};

/**
 * Resolve the session cookie into a User (or null) and attach it to the context.
 * Always runs; never blocks. Routes that require auth use `requireUser`.
 */
export const authMiddleware = createMiddleware<{
  Bindings: Env;
  Variables: AuthVariables;
}>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    c.set("user", null);
    return next();
  }

  const db = createDb(c.env.DB);
  const { session, user } = await validateSessionToken(db, token);
  if (!session) {
    clearSessionCookie(c);
    c.set("user", null);
    return next();
  }

  c.set("user", user);
  return next();
});

/**
 * Guard for protected routes: 401 unless a User is present. On success, exposes
 * a non-null `user` for downstream handlers.
 */
export const requireUser = createMiddleware<{
  Bindings: Env;
  Variables: AuthVariables;
}>(async (c, next) => {
  if (!c.get("user")) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});
