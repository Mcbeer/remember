import { Google, decodeIdToken } from "arctic";
import type { OAuthProfile } from "./users.ts";

// arctic's Google provider, constructed per-request from secrets on the Env.
export function googleProvider(env: Env): Google {
  return new Google(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_REDIRECT_URI,
  );
}

export const GOOGLE_SCOPES = ["openid", "email", "profile"];

type GoogleClaims = {
  sub: string;
  email: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
};

/**
 * Extract a normalized profile from Google's id_token. The token comes straight
 * from Google's token endpoint over TLS in exchange for our verified code, so we
 * trust its claims without re-verifying the JWT signature.
 */
export function profileFromIdToken(idToken: string): OAuthProfile {
  const claims = decodeIdToken(idToken) as GoogleClaims;
  return {
    provider: "google",
    providerUserId: claims.sub,
    email: claims.email,
    emailVerified: claims.email_verified === true,
    name: claims.name,
    avatarUrl: claims.picture,
  };
}
