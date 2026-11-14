/**
 * Client-side cryptography for private account data and end-to-end encrypted rooms.
 * The backend stores ciphertext and public keys only; the account private key is
 * encrypted with a password-derived AES-GCM key and held in memory after unlock.
 */

export type CipherBlob = { iv: string; ciphertext: string };
export type AccountBundle = {
  cryptoSalt: string;
  cryptoPublicKey: JsonWebKey;
  wrappedPrivateKey: CipherBlob & { iterations: number };
  encryptedProfile: CipherBlob;
};

const PBKDF2_ITERATIONS = 600_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let privateKey: CryptoKey | null = null;
let accountDataKey: CryptoKey | null = null;
let currentUserId: string | null = null;
const roomKeys = new Map<string, Map<number, CryptoKey>>();

function toBase64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < view.length; i += 0x8000) {
    binary += String.fromCharCode(...view.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// TypeScript 5.7+ models Uint8Array<ArrayBufferLike>, while Web Crypto's DOM
// signatures require an ArrayBuffer-backed BufferSource. Copying into a fresh
// ArrayBuffer satisfies the platform type and avoids passing SharedArrayBuffer.
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function randomBytes(length: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(length));
}

async function derivePasswordKey(password: string, salt: Uint8Array, iterations = PBKDF2_ITERATIONS) {
  const material = await crypto.subtle.importKey("raw", toArrayBuffer(encoder.encode(password)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: toArrayBuffer(salt), iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptBytes(key: CryptoKey, clear: Uint8Array, context: string): Promise<CipherBlob> {
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(encoder.encode(context)), tagLength: 128 },
    key,
    toArrayBuffer(clear),
  );
  return { iv: toBase64(iv), ciphertext: toBase64(ciphertext) };
}

async function decryptBytes(key: CryptoKey, blob: CipherBlob, context: string): Promise<Uint8Array> {
  const clear = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(fromBase64(blob.iv)),
      additionalData: toArrayBuffer(encoder.encode(context)),
      tagLength: 128,
    },
    key,
    toArrayBuffer(fromBase64(blob.ciphertext)),
  );
  return new Uint8Array(clear);
}

export async function createAccountBundle(password: string, profile: Record<string, unknown>): Promise<AccountBundle> {
  lockAccount();
  const salt = randomBytes(16);
  const dataKey = await derivePasswordKey(password, salt);
  const pair = await crypto.subtle.generateKey(
    { name: "RSA-OAEP", modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" } as RsaHashedKeyGenParams,
    true,
    ["encrypt", "decrypt"],
  );
  const privateBytes = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  const wrappedPrivateKey = await encryptBytes(dataKey, privateBytes, "chat-app-private-key-v1");
  const nonExtractablePrivateKey = await crypto.subtle.importKey("pkcs8", toArrayBuffer(privateBytes), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
  privateBytes.fill(0);
  const encryptedProfile = await encryptBytes(dataKey, encoder.encode(JSON.stringify(profile)), "chat-app-private-profile-v1");
  const cryptoPublicKey = await crypto.subtle.exportKey("jwk", pair.publicKey);
  privateKey = nonExtractablePrivateKey;
  accountDataKey = dataKey;
  roomKeys.clear();
  return {
    cryptoSalt: toBase64(salt),
    cryptoPublicKey,
    wrappedPrivateKey: { ...wrappedPrivateKey, iterations: PBKDF2_ITERATIONS },
    encryptedProfile,
  };
}

export async function unlockAccount(
  userId: string,
  password: string,
  bundle: {
    cryptoSalt: string;
    cryptoPublicKey: JsonWebKey;
    wrappedPrivateKey: CipherBlob & { iterations: number };
  },
): Promise<void> {
  lockAccount();
  const salt = fromBase64(bundle.cryptoSalt);
  if (bundle.wrappedPrivateKey.iterations < 300_000 || bundle.wrappedPrivateKey.iterations > 2_000_000) {
    throw new Error("Unsupported account encryption settings. Contact the administrator.");
  }
  const dataKey = await derivePasswordKey(password, salt, bundle.wrappedPrivateKey.iterations);
  const pkcs8 = await decryptBytes(dataKey, bundle.wrappedPrivateKey, "chat-app-private-key-v1");
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("pkcs8", toArrayBuffer(pkcs8), { name: "RSA-OAEP", hash: "SHA-256" }, false, ["decrypt"]);
  } finally {
    pkcs8.fill(0);
  }
  // Verify that the server-returned public key is actually paired with the
  // password-unwrapped private key before trusting it for future key exchange.
  const publicKey = await crypto.subtle.importKey("jwk", bundle.cryptoPublicKey, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const challenge = randomBytes(32);
  const probe = await crypto.subtle.encrypt(
    { name: "RSA-OAEP", label: toArrayBuffer(encoder.encode("chat-app-identity-check-v1")) },
    publicKey,
    toArrayBuffer(challenge),
  );
  const recovered = new Uint8Array(await crypto.subtle.decrypt(
    { name: "RSA-OAEP", label: toArrayBuffer(encoder.encode("chat-app-identity-check-v1")) },
    key,
    toArrayBuffer(new Uint8Array(probe)),
  ));
  if (recovered.length !== challenge.length || recovered.some((value, index) => value !== challenge[index])) {
    throw new Error("Your account encryption identity key does not match. Do not continue.");
  }
  privateKey = key;
  accountDataKey = dataKey;
  currentUserId = userId;
  roomKeys.clear();
}

export function lockAccount() {
  privateKey = null;
  accountDataKey = null;
  currentUserId = null;
  roomKeys.clear();
}

export function isCryptoUnlocked() { return Boolean(privateKey && accountDataKey); }

/** Short SHA-256 fingerprint for verifying a contact's public key out of band. */
export async function fingerprintPublicKey(jwk: JsonWebKey): Promise<string> {
  if (jwk.kty !== "RSA" || !jwk.n || !jwk.e) throw new Error("Unsupported public key");
  const canonical = JSON.stringify({ kty: jwk.kty, n: jwk.n, e: jwk.e, alg: jwk.alg ?? "RSA-OAEP-256" });
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(encoder.encode(canonical))));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase().match(/.{1,4}/g)!.join(" ");
}
export function getCurrentUserId() { return currentUserId; }

export async function decryptPrivateProfile(blob: CipherBlob): Promise<Record<string, unknown>> {
  if (!accountDataKey) throw new Error("Your encryption key is locked. Log in again.");
  const clear = await decryptBytes(accountDataKey, blob, "chat-app-private-profile-v1");
  return JSON.parse(decoder.decode(clear)) as Record<string, unknown>;
}

export async function encryptPrivateProfile(profile: Record<string, unknown>): Promise<CipherBlob> {
  if (!accountDataKey) throw new Error("Your encryption key is locked. Log in again.");
  return encryptBytes(accountDataKey, encoder.encode(JSON.stringify(profile)), "chat-app-private-profile-v1");
}

export async function createRoomKey() {
  const raw = randomBytes(32);
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(new Uint8Array(raw)), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  return { raw, key };
}

export async function wrapRoomKeyForUser(rawRoomKey: Uint8Array, publicJwk: JsonWebKey): Promise<string> {
  const publicKey = await crypto.subtle.importKey("jwk", publicJwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const wrapped = await crypto.subtle.encrypt(
    { name: "RSA-OAEP", label: toArrayBuffer(encoder.encode("chat-app-room-key-v1")) },
    publicKey,
    toArrayBuffer(rawRoomKey),
  );
  return toBase64(wrapped);
}

export async function unwrapRoomKey(roomId: string, wrappedKey: string, version = 1): Promise<CryptoKey> {
  const cached = roomKeys.get(roomId)?.get(version);
  if (cached) return cached;
  if (!privateKey) throw new Error("Your encryption key is locked. Log in again.");
  const raw = await crypto.subtle.decrypt(
    { name: "RSA-OAEP", label: toArrayBuffer(encoder.encode("chat-app-room-key-v1")) },
    privateKey,
    toArrayBuffer(fromBase64(wrappedKey)),
  );
  const key = await crypto.subtle.importKey("raw", toArrayBuffer(new Uint8Array(raw)), { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  cacheRoomKey(roomId, version, key);
  return key;
}

export function cacheRoomKey(roomId: string, version: number, key: CryptoKey) {
  const versions = roomKeys.get(roomId) ?? new Map<number, CryptoKey>();
  versions.set(version, key);
  roomKeys.set(roomId, versions);
}

export async function encryptRoomText(roomId: string, text: string, version = 1): Promise<CipherBlob> {
  const key = roomKeys.get(roomId)?.get(version);
  if (!key) throw new Error("This room has no unlocked encryption key.");
  return encryptBytes(key, encoder.encode(text), `chat-app-message-v1:${roomId}:${version}`);
}

export async function decryptRoomText(roomId: string, blob: CipherBlob, version = 1): Promise<string> {
  const key = roomKeys.get(roomId)?.get(version);
  if (!key) throw new Error("This room has no unlocked encryption key.");
  return decoder.decode(await decryptBytes(key, blob, `chat-app-message-v1:${roomId}:${version}`));
}

export async function encryptRoomMetadataWithKey(key: CryptoKey, metadata: { name: string; description?: string }) {
  return encryptBytes(key, encoder.encode(JSON.stringify(metadata)), "chat-app-room-metadata-v1");
}

export async function decryptRoomMetadata(roomId: string, blob: CipherBlob, version = 1) {
  const key = roomKeys.get(roomId)?.get(version);
  if (!key) throw new Error("This room has no unlocked encryption key.");
  return JSON.parse(decoder.decode(await decryptBytes(key, blob, "chat-app-room-metadata-v1"))) as { name: string; description?: string };
}

export async function makeSelfKeyEnvelope(rawRoomKey: Uint8Array, publicJwk: JsonWebKey) {
  if (!currentUserId) throw new Error("Account identity is not available.");
  return { userId: currentUserId, wrappedKey: await wrapRoomKeyForUser(rawRoomKey, publicJwk) };
}

export function base64UrlSafePublicKey(jwk: JsonWebKey) {
  return jwk;
}

/** Invitation display labels are encrypted with a key derived from the high-entropy invite token. */
export function createInvitationToken(): string {
  return toBase64(randomBytes(32)).split("+").join("-").split("/").join("_").replace(/=+$/, "");
}

export async function encryptInvitationLabel(token: string, label: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(encoder.encode("alta-chat-invite-label-key-v1:" + token)));
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = randomBytes(12);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv), additionalData: toArrayBuffer(encoder.encode("alta-chat-invite-label-v1")), tagLength: 128 },
    key,
    toArrayBuffer(encoder.encode(label)),
  );
  return btoa(JSON.stringify({ iv: toBase64(iv), ciphertext: toBase64(ciphertext) }))
    .split("+").join("-").split("/").join("_").replace(/=+$/, "");
}

export async function decryptInvitationLabel(token: string, encrypted: string): Promise<string> {
  const normalized = encrypted.replace(/-/g, "+").replace(/_/g, "/");
  const json = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  const blob = JSON.parse(json) as CipherBlob;
  const digest = await crypto.subtle.digest("SHA-256", toArrayBuffer(encoder.encode("alta-chat-invite-label-key-v1:" + token)));
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(fromBase64(blob.iv)), additionalData: toArrayBuffer(encoder.encode("alta-chat-invite-label-v1")), tagLength: 128 },
    key,
    toArrayBuffer(fromBase64(blob.ciphertext)),
  );
  return decoder.decode(clear);
}
