import type { Context } from "hono";
import { setCookie, deleteCookie } from "hono/cookie";

// __Host- prefix requires Secure, Path=/, and no Domain — the browser enforces
// it, hardening against subdomain/cookie-fixation attacks.
export const SESSION_COOKIE = "__Host-session";

// Short-lived cookies holding OAuth state + PKCE verifier between the start and
// callback legs of the flow.
export const OAUTH_STATE_COOKIE = "__Host-oauth_state";
export const OAUTH_VERIFIER_COOKIE = "__Host-oauth_verifier";
export const OAUTH_RETURN_COOKIE = "__Host-oauth_return";

const TEN_MINUTES = 60 * 10;

export function setSessionCookie(
  c: Context,
  token: string,
  expiresAt: string,
): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
}

export function setOAuthFlowCookies(
  c: Context,
  state: string,
  verifier: string,
): void {
  const opts = {
    httpOnly: true,
    secure: true,
    sameSite: "Lax" as const,
    path: "/",
    maxAge: TEN_MINUTES,
  };
  setCookie(c, OAUTH_STATE_COOKIE, state, opts);
  setCookie(c, OAUTH_VERIFIER_COOKIE, verifier, opts);
}

export function setReturnCookie(c: Context, returnTo: string): void {
  setCookie(c, OAUTH_RETURN_COOKIE, returnTo, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: TEN_MINUTES,
  });
}

export function clearOAuthFlowCookies(c: Context): void {
  deleteCookie(c, OAUTH_STATE_COOKIE, { path: "/", secure: true });
  deleteCookie(c, OAUTH_VERIFIER_COOKIE, { path: "/", secure: true });
  deleteCookie(c, OAUTH_RETURN_COOKIE, { path: "/", secure: true });
}

// Only allow same-origin relative paths as a post-login redirect target, to
// prevent open-redirect abuse via the returnTo parameter.
export function safeReturnPath(value: string | undefined): string {
  if (value && value.startsWith("/") && !value.startsWith("//")) return value;
  return "/";
}
