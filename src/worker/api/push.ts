import { Hono } from "hono";
import { createDb } from "../db/index.ts";
import type { AuthVariables } from "../auth/middleware.ts";
import { requireUser } from "../auth/middleware.ts";
import {
  saveSubscription,
  deleteSubscription,
} from "../repo/push-subscriptions.ts";

type Ctx = { Bindings: Env; Variables: AuthVariables };

// Device push subscriptions and the public VAPID key the client needs to
// subscribe. Subscriptions are per-device and owned by the calling User.
export const pushRoutes = new Hono<Ctx>();

// The VAPID public key is needed by the service-worker registration before the
// User is necessarily logged in, so this endpoint is open (the key is public).
pushRoutes.get("/key", (c) => {
  return c.json({ publicKey: c.env.VAPID_PUBLIC_KEY });
});

pushRoutes.use("*", requireUser);

// Register (or refresh) this device's subscription. Body is the browser's
// PushSubscription JSON: { endpoint, keys: { p256dh, auth } }.
pushRoutes.post("/subscribe", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  const body = await c.req.json<{
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  }>();

  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  const p256dh =
    typeof body.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const auth = typeof body.keys?.auth === "string" ? body.keys.auth : "";
  if (!endpoint || !p256dh || !auth) {
    return c.json(
      { error: "endpoint and keys.p256dh and keys.auth are required" },
      400,
    );
  }

  const sub = await saveSubscription(db, user.id, { endpoint, p256dh, auth });
  return c.json({ id: sub.id }, 201);
});

// Remove this device's subscription (on permission revoke / logout). Body:
// { endpoint }.
pushRoutes.delete("/subscribe", async (c) => {
  const db = createDb(c.env.DB);
  const user = c.get("user")!;
  const body = await c.req.json<{ endpoint?: unknown }>();
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  if (!endpoint) return c.json({ error: "endpoint is required" }, 400);

  const ok = await deleteSubscription(db, user.id, endpoint);
  if (!ok) return c.json({ error: "Not found" }, 404);
  return c.body(null, 204);
});
