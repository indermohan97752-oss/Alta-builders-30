import { z } from "zod";

const MAX_PASSWORD_BYTES = 72;
const base64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).min(16).max(16_384);
const username = z.string().trim().regex(/^[A-Za-z0-9_]{3,30}$/, "Username must be 3-30 characters: letters, numbers or underscores");
const password = z.string().min(12, "Password must be at least 12 characters")
  .refine((p) => Buffer.byteLength(p, "utf8") <= MAX_PASSWORD_BYTES, "Password is too long (72 bytes max)")
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), "Password must include at least one letter and one number");
const publicKey = z.object({
  kty: z.literal("RSA"),
  n: z.string().regex(/^[A-Za-z0-9_-]{500,520}$/, "RSA identity keys must be 3072-bit"),
  e: z.literal("AQAB"),
  alg: z.string().optional(),
  ext: z.boolean().optional(),
  key_ops: z.array(z.string()).optional(),
}).strict();
const encryptedBlob = z.object({ iv: base64.length(16), ciphertext: base64.min(24) }).strict();

export const signupSchema = z.object({
  username,
  password,
  adminBootstrapToken: z.string().min(40).max(200).optional(),
  cryptoSalt: z.string().regex(/^[A-Za-z0-9+/]{22}==$/),
  cryptoPublicKey: publicKey,
  wrappedPrivateKey: encryptedBlob.extend({ iterations: z.number().int().min(300_000).max(2_000_000) }),
  encryptedProfile: encryptedBlob,
}).strict();

export const loginSchema = z.object({
  username,
  password: z.string().min(1).max(72).refine((p) => Buffer.byteLength(p, "utf8") <= MAX_PASSWORD_BYTES, "Password is too long (72 bytes max)"),
}).strict();

export const profileSchema = z.object({ encryptedProfile: encryptedBlob }).strict();
export type SignupInput = z.infer<typeof signupSchema>;
