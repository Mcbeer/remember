import { api } from "./api.ts";

// Browser-side Web Push glue: register the service worker, ask for permission,
// subscribe with the server's VAPID public key, and sync the subscription to the
// backend (per-device). Mirrors the server-side push pipeline in
// src/worker/push.

// Web Push is unavailable on some browsers (notably iOS Safari unless installed
// as a PWA). Callers should hide the reminder UI when this is false.
export function pushSupported(): boolean {
  return (
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export function notificationPermission(): NotificationPermission {
  return "Notification" in window ? Notification.permission : "denied";
}

// VAPID public key arrives base64url; PushManager wants an ArrayBuffer-backed
// view (applicationServerKey).
function urlBase64ToUint8Array(base64Url: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64Url.length % 4)) % 4);
  const base64 = (base64Url + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  // The SW is served from the origin root (public/sw.js) for root scope.
  const existing = await navigator.serviceWorker.getRegistration();
  if (existing) return existing;
  return navigator.serviceWorker.register("/sw.js");
}

/**
 * Enable reminders on this device: request permission, subscribe to push, and
 * register the subscription with the backend. Returns true on success. Throws
 * if the user denies permission or push is unsupported.
 */
export async function enablePush(): Promise<boolean> {
  if (!pushSupported()) throw new Error("Push is not supported on this device");

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const reg = await getRegistration();
  await navigator.serviceWorker.ready;

  const { publicKey } = await api.push.key();

  // Reuse an existing subscription if present; otherwise create one.
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }

  await api.push.subscribe(sub.toJSON());
  return true;
}

/** Disable reminders on this device: unsubscribe and tell the backend to prune. */
export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (sub) {
    await api.push.unsubscribe(sub.endpoint).catch(() => undefined);
    await sub.unsubscribe().catch(() => undefined);
  }
}

/** True if this device already has an active push subscription. */
export async function isPushEnabled(): Promise<boolean> {
  if (!pushSupported() || notificationPermission() !== "granted") return false;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return !!sub;
}
