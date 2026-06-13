import { describe, expect, it } from "vitest";
import { encryptPayload } from "../src/worker/push/web-push.ts";
import {
  base64UrlEncode,
  base64UrlDecode,
} from "../src/worker/push/base64url.ts";

// These run on workerd (vitest-pool-workers), i.e. the SAME runtime as
// production — so they catch runtime/type mismatches the local TS types miss
// (e.g. the ECDH `public` vs `$public` param). We simulate a browser (UA)
// subscription keypair, encrypt to it, then decrypt as the UA would, asserting
// the RFC 8291 aes128gcm roundtrip succeeds on the real engine.

async function makeUaSubscription() {
  const uaKeys = (await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  )) as CryptoKeyPair;
  const uaPublic = new Uint8Array(
    (await crypto.subtle.exportKey("raw", uaKeys.publicKey)) as ArrayBuffer,
  );
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  return {
    uaKeys,
    uaPublic,
    authSecret,
    target: {
      endpoint: "https://push.example/abc",
      p256dh: base64UrlEncode(uaPublic),
      auth: base64UrlEncode(authSecret),
    },
  };
}

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

describe("Web Push aes128gcm encryption (on workerd)", () => {
  it("encrypts a payload the UA can decrypt (RFC 8291 roundtrip)", async () => {
    const { uaKeys, uaPublic, authSecret, target } =
      await makeUaSubscription();
    const expected = JSON.stringify({ title: "Remember", body: "Pay rent" });

    const body = await encryptPayload(
      new TextEncoder().encode(expected),
      target,
    );

    // Parse the aes128gcm content-coding header.
    const salt = body.slice(0, 16);
    const idlen = body[20];
    const serverPublic = body.slice(21, 21 + idlen);
    const ciphertext = body.slice(21 + idlen);

    // UA derives the same secrets via ECDH against the server public key.
    const serverPubKey = await crypto.subtle.importKey(
      "raw",
      serverPublic,
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    const shared = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "ECDH", public: serverPubKey } as unknown as Parameters<
          typeof crypto.subtle.deriveBits
        >[0],
        uaKeys.privateKey,
        256,
      ),
    );

    const enc = new TextEncoder();
    const keyInfo = concat(
      enc.encode("WebPush: info\0"),
      uaPublic,
      serverPublic,
    );
    const ikm = await hkdf(authSecret, shared, keyInfo, 32);
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

    const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, [
      "decrypt",
    ]);
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce },
        aesKey,
        ciphertext,
      ),
    );

    // Strip trailing zero padding then the 0x02 last-record delimiter.
    let end = plaintext.length;
    while (end > 0 && plaintext[end - 1] === 0) end--;
    end--; // remove the 0x02
    const decoded = new TextDecoder().decode(plaintext.slice(0, end));

    expect(decoded).toBe(expected);
  });

  it("base64url roundtrips arbitrary bytes", () => {
    const bytes = crypto.getRandomValues(new Uint8Array(65));
    expect(base64UrlDecode(base64UrlEncode(bytes))).toEqual(bytes);
  });
});
