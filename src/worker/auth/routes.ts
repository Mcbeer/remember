import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { generateState, generateCodeVerifier } from "arctic";
import { OAuth2RequestError } from "arctic";
import { createDb } from "../db/index.ts";
import {
  googleProvider,
  GOOGLE_SCOPES,
  profileFromIdToken,
} from "./google.ts";
import { upsertUserFromOAuth, AuthError } from "./users.ts";
import {
  createSession,
  generateSessionToken,
  invalidateSession,
} from "./session.ts";
import {
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  OAUTH_RETURN_COOKIE,
  SESSION_COOKIE,
  clearOAuthFlowCookies,
  clearSessionCookie,
  setOAuthFlowCookies,
  setReturnCookie,
  setSessionCookie,
  safeReturnPath,
} from "./cookies.ts";
import type { AuthVariables } from "./middleware.ts";

export const authRoutes = new Hono<{
  Bindings: Env;
  Variables: AuthVariables;
}>();

// Leg 1: redirect to Google with fresh state + PKCE verifier (stashed in cookies).
authRoutes.get("/google", (c) => {
  const state = generateState();
  const codeVerifier = generateCodeVerifier();
  const url = googleProvider(c.env).createAuthorizationURL(
    state,
    codeVerifier,
    GOOGLE_SCOPES,
  );
  setOAuthFlowCookies(c, state, codeVerifier);
  const returnTo = c.req.query("returnTo");
  if (returnTo) setReturnCookie(c, safeReturnPath(returnTo));
  return c.redirect(url.toString());
});

// Leg 2: Google redirects back. Verify state, exchange the code, resolve the
// User, create a session, and land the user in the app.
authRoutes.get("/google/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const storedState = getCookie(c, OAUTH_STATE_COOKIE);
  const codeVerifier = getCookie(c, OAUTH_VERIFIER_COOKIE);
  const returnTo = safeReturnPath(getCookie(c, OAUTH_RETURN_COOKIE));
  clearOAuthFlowCookies(c);

  if (!code || !state || !storedState || !codeVerifier) {
    return c.json({ error: "Missing OAuth parameters" }, 400);
  }
  if (state !== storedState) {
    return c.json({ error: "Invalid OAuth state" }, 400);
  }

  let idToken: string;
  try {
    const tokens = await googleProvider(c.env).validateAuthorizationCode(
      code,
      codeVerifier,
    );
    idToken = tokens.idToken();
  } catch (err) {
    if (err instanceof OAuth2RequestError) {
      return c.json({ error: "OAuth exchange failed" }, 400);
    }
    throw err;
  }

  const profile = profileFromIdToken(idToken);
  const db = createDb(c.env.DB);

  let user;
  try {
    user = await upsertUserFromOAuth(db, profile);
  } catch (err) {
    if (err instanceof AuthError) {
      // Land the SPA on a page that can explain the conflict to the user.
      return c.redirect(`/login?error=${err.code}`);
    }
    throw err;
  }

  const token = generateSessionToken();
  const session = await createSession(db, token, user.id);
  setSessionCookie(c, token, session.expiresAt);

  return c.redirect(returnTo);
});

// Log out: revoke the current session and clear the cookie.
authRoutes.post("/logout", async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const db = createDb(c.env.DB);
    await invalidateSession(db, token);
  }
  clearSessionCookie(c);
  return c.json({ ok: true });
});
