import { z } from "zod";

export const objectId = z.string().regex(/^[a-f0-9]{24}$/i, "Invalid id");
export const isObjectId = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{24}$/i.test(v);
const base64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).min(16).max(16_384);
export const encryptedBlob = z.object({ iv: base64.length(16), ciphertext: base64.min(24) }).strict();
export const keyEnvelope = z.object({ userId: objectId, wrappedKey: base64.length(512) }).strict();
const uniqueIds = (max: number, min = 0) => z.array(objectId).min(min).max(max).transform((ids) => [...new Set(ids)]);
const keyEnvelopeArray = z.array(keyEnvelope).min(1).max(100).refine(
  (items) => new Set(items.map((item) => item.userId)).size === items.length,
  "Duplicate key recipient",
);

export const createRoomSchema = z.object({
  memberIds: uniqueIds(99).default([]),
  encryptedMetadata: encryptedBlob,
  keyEnvelopes: keyEnvelopeArray,
}).strict();
export const updateRoomSchema = z.object({ encryptedMetadata: encryptedBlob }).strict();
export const addMembersSchema = z.object({
  userIds: uniqueIds(50, 1),
  encryptedMetadata: encryptedBlob,
  keyEnvelopes: keyEnvelopeArray,
}).strict();
export const rotationSchema = z.object({ encryptedMetadata: encryptedBlob, keyEnvelopes: keyEnvelopeArray }).strict();
export const roleSchema = z.object({ role: z.enum(["admin", "member"]) });
export const mutedSchema = z.object({ isMuted: z.boolean() });
export const dmSchema = z.object({ userId: objectId, encryptedMetadata: encryptedBlob, keyEnvelopes: keyEnvelopeArray }).strict();
