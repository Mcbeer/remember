// A dependency-free Web Push sender built on WebCrypto (works on Workers).
//
// Two specs are involved:
//   * VAPID (RFC 8292): we authenticate to the push service with a short-lived
//     ES256 JWT signed by our VAPID private key, plus our public key.
//   * Message Encryption (RFC 8291, "aes128gcm" content-encoding): the payload
//     is encrypted to the subscription's public key (p256dh) so only the user's
//     browser can read it. The push service only relays opaque ciphertext.
//
// We never use a library here so the whole crypto path stays auditable and runs
// natively on the Workers runtime.

import { base64UrlDecode, base64UrlEncode } from "./base64url.ts";

// A browser push subscription's transport details (from the PushSubscription the
// service worker hands us, stored per-device in `push_subscriptions`).
export type PushTarget = {
  endpoint: string;
  p256dh: string; // base64url subscription public key (uncompressed P-256 point)
  auth: string; // base64url 16-byte auth secret
};

// The VAPID identity: the keypair (base64url) plus a contact subject (mailto:/https:).
export type VapidKeys = {
  publicKey: string; // base64url uncompressed point (also the client appServerKey)
  privateKey: string; // base64url PKCS8
  subject: string;
};

export type SendResult = {
  endpoint: string;
  status: number;
  // Push services return 404/410 when a subscription is gone; callers prune it.
  gone: boolean;
};

const ONE_DAY_S = 60 * 60 * 24;

// --- VAPID JWT (RFC 8292) -------------------------------------------------

async function importVapidPrivateKey(pkcs8B64Url: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "pkcs8",
    base64UrlDecode(pkcs8B64Url),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
}

// Build and sign the VAPID JWT for the push service `aud` (its origin).
async function buildVapidJwt(
  audience: string,
  vapid: VapidKeys,
): Promise<string> {
  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + ONE_DAY_S,
    sub: vapid.subject,
  };

  const enc = new TextEncoder();
  const signingInput =
    base64UrlEncode(enc.encode(JSON.stringify(header))) +
    "." +
    base64UrlEncode(enc.encode(JSON.stringify(payload)));

  const key = await importVapidPrivateKey(vapid.privateKey);
  // WebCrypto ECDSA returns the raw r||s (64-byte) signature JWS/ES256 wants.
  const sig = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    enc.encode(signingInput),
  );

  return signingInput + "." + base64UrlEncode(new Uint8Array(sig));
}

// The push service origin (scheme + host) is the JWT audience.
function audienceOf(endpoint: string): string {
  const u = new URL(endpoint);
  return `${u.protocol}//${u.host}`;
}

// --- Payload encryption (RFC 8291, aes128gcm) -----------------------------

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

async function hkdf(
  salt: Uint8Array,
  ikm: Uint8Array,
  info: Uint8Array,
  length: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

// Encrypt `payload` to the subscription keys per RFC 8291. Returns the body for
// the POST (salt | rs(4) | idlen(1) | server-public-key | ciphertext).
// Exported for tests so the crypto path runs on the real Workers runtime
// (the local WebCrypto types disagree with workerd on the ECDH param name).
export async function encryptPayload(
  payload: Uint8Array,
  target: PushTarget,
): Promise<Uint8Array> {
  const uaPublic = base64UrlDecode(target.p256dh); // 65 bytes
  const authSecret = base64UrlDecode(target.auth); // 16 bytes

  // Ephemeral server keypair for this message (ECDH with the UA public key).
  const serverKeys = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const serverPublic = new Uint8Array(
    (await crypto.subtle.exportKey("raw", serverKeys.publicKey)) as ArrayBuffer,
  ); // 65 bytes

  const uaPublicKey = await crypto.subtle.importKey(
    "raw",
    uaPublic,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      // The Workers runtime expects the standard WebCrypto `public` field here.
      // The generated workers-types call it `$public`, which is wrong at
      // runtime (it throws "Missing field public"), so we use `public` and cast.
      { name: "ECDH", public: uaPublicKey } as unknown as SubtleCryptoDeriveKeyAlgorithm,
      serverKeys.privateKey,
      256,
    ),
  ); // 32 bytes

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const enc = new TextEncoder();

  // PRK_key = HKDF(auth_secret, ecdh_secret, "WebPush: info\0" | ua_pub | server_pub, 32)
  const keyInfo = concat(
    enc.encode("WebPush: info\0"),
    uaPublic,
    serverPublic,
  );
  const ikm = await hkdf(authSecret, sharedSecret, keyInfo, 32);

  // CEK and nonce derived from the salt and the IKM above.
  const cek = await hkdf(
    salt,
    ikm,
    enc.encode("Content-Encoding: aes128gcm\0"),
    16,
  );
  const nonce = await hkdf(
    salt,
    ikm,
    enc.encode("Content-Encoding: nonce\0"),
    12,
  );

  // aes128gcm requires a padding delimiter (0x02 = last record) before the
  // optional zero padding; we use a single record with no extra padding.
  const plaintext = concat(payload, new Uint8Array([0x02]));

  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, [
    "encrypt",
  ]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      aesKey,
      plaintext,
    ),
  );

  // aes128gcm content-coding header: salt(16) | rs(4, big-endian) | idlen(1) | keyid
  // keyid is the server public key so the UA can do its own ECDH.
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + serverPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs, false);
  header[20] = serverPublic.length;
  header.set(serverPublic, 21);

  return concat(header, ciphertext);
}

// --- Public API -----------------------------------------------------------

/**
 * Send one Web Push message. `payload` is JSON-serialisable; the service worker
 * receives it as the notification data. Returns the HTTP status and whether the
 * subscription is gone (404/410) so the caller can prune dead device rows.
 */
export async function sendWebPush(
  target: PushTarget,
  payload: unknown,
  vapid: VapidKeys,
): Promise<SendResult> {
  const body = await encryptPayload(
    new TextEncoder().encode(JSON.stringify(payload)),
    target,
  );

  const jwt = await buildVapidJwt(audienceOf(target.endpoint), vapid);

  const res = await fetch(target.endpoint, {
    method: "POST",
    headers: {
      // RFC 8292: VAPID "vapid" scheme carries the JWT (t) and our public key (k).
      Authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
    },
    body,
  });

  // Drain the body so the connection can be reused; we only need the status.
  await res.arrayBuffer().catch(() => undefined);

  return {
    endpoint: target.endpoint,
    status: res.status,
    gone: res.status === 404 || res.status === 410,
  };
}
