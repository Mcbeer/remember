// Secrets are not declared in wrangler.jsonc (so they stay out of source), so we
// extend the generated Env with their types here. Provide values locally via
// `.dev.vars` and in production via `wrangler secret put`.
interface Env {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  GOOGLE_REDIRECT_URI: string;
  // Web Push / Reminders (VAPID). See PROGRESS.md.
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
}
