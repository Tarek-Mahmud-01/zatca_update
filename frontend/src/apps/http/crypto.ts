/**
 * ECDH + AES-256-GCM payload encryption using the Web Crypto API.
 *
 * Flow (once per session):
 *   1. Fetch server's EC P-256 public key from GET /api/v1/crypto/pubkey
 *   2. Generate an ephemeral client P-256 key pair
 *   3. ECDH(client_priv, server_pub) → 32-byte shared secret
 *   4. HKDF-SHA-256(shared_secret, salt="zatca-api-v1", info="aes-gcm") → AES-256-GCM key
 *
 * Subsequent calls use the cached key — no extra round trips.
 */

const HKDF_SALT = new TextEncoder().encode("zatca-api-v1");
const HKDF_INFO = new TextEncoder().encode("aes-gcm");
const BACKEND = process.env.BACKEND_URL ?? "http://127.0.0.1:8001";

interface CryptoSession {
  aesKey: CryptoKey;
  clientPubkeyB64: string;
}

let _session: CryptoSession | null = null;
let _initPromise: Promise<CryptoSession> | null = null;

async function buildSession(): Promise<CryptoSession> {
  // Fetch server's EC public key (SPKI-DER, base64-encoded)
  const res = await fetch(`${BACKEND}/api/v1/crypto/pubkey`);
  if (!res.ok) throw new Error(`crypto: pubkey fetch failed (${res.status})`);
  const { pubkey: serverB64 } = (await res.json()) as { pubkey: string };

  const serverDer = Uint8Array.from(atob(serverB64), (c) => c.charCodeAt(0));
  const serverPub = await crypto.subtle.importKey(
    "spki",
    serverDer,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );

  // Generate ephemeral client P-256 key pair (extractable so we can export the pubkey)
  const clientPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );

  // Export client public key as SPKI-DER → base64
  const clientPubDer = await crypto.subtle.exportKey("spki", clientPair.publicKey);
  const clientPubkeyB64 = btoa(String.fromCharCode(...new Uint8Array(clientPubDer)));

  // ECDH: derive shared bits (32 bytes, P-256 x-coordinate)
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: serverPub },
    clientPair.privateKey,
    256,
  );

  // HKDF: shared bits → AES-256-GCM key
  const hkdfKey = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
  const aesKey = await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: HKDF_SALT, info: HKDF_INFO },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );

  return { aesKey, clientPubkeyB64 };
}

export async function initCrypto(): Promise<CryptoSession> {
  if (_session) return _session;
  if (!_initPromise) _initPromise = buildSession().then((s) => { _session = s; return s; });
  return _initPromise;
}

/** Encrypt a JSON string. Returns the envelope JSON and the client public key. */
export async function encryptBody(plaintext: string): Promise<{ body: string; pubkey: string }> {
  const { aesKey, clientPubkeyB64 } = await initCrypto();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ctBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    aesKey,
    new TextEncoder().encode(plaintext),
  );
  const body = JSON.stringify({
    iv: btoa(String.fromCharCode(...iv)),
    data: btoa(String.fromCharCode(...new Uint8Array(ctBuf))),
  });
  return { body, pubkey: clientPubkeyB64 };
}

/** Decrypt an envelope JSON string returned by the backend. */
export async function decryptBody(envelope: string): Promise<string> {
  const { aesKey } = await initCrypto();
  const { iv: ivB64, data: dataB64 } = JSON.parse(envelope) as { iv: string; data: string };
  const iv = Uint8Array.from(atob(ivB64), (c) => c.charCodeAt(0));
  const ct = Uint8Array.from(atob(dataB64), (c) => c.charCodeAt(0));
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, aesKey, ct);
  return new TextDecoder().decode(pt);
}

/** Force a new ECDH session on next request (e.g. after logout). */
export function resetCrypto(): void {
  _session = null;
  _initPromise = null;
}
