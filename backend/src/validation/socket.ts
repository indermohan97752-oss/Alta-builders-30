import { z } from "zod";
import { objectId } from "./rooms.js";

const base64 = z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/);
export const sendMessageEventSchema = z.object({
  roomId: objectId,
  encryptedContent: base64.min(24).max(16_384),
  encryptedIv: base64.length(16),
  keyVersion: z.number().int().min(1).max(1_000_000),
  replyToId: objectId.nullable().optional(),
}).strict();

export const readMessageEventSchema = z.object({
  roomId: objectId,
  messageId: objectId,
}).strict();

export const typingEventSchema = z.object({
  roomId: objectId,
  isTyping: z.boolean(),
}).strict();

// WebRTC signaling payloads are short-lived, authenticated metadata only.
// SDP and ICE candidates are forwarded and never persisted.
export const callSignalEventSchema = z.object({
  roomId: objectId,
  targetUserId: objectId,
  callId: z.string().uuid(),
  kind: z.enum(["offer", "answer", "ice", "hangup", "reject"]),
  data: z.record(z.unknown()).optional().refine(
    (value) => value === undefined || JSON.stringify(value).length <= 20_000,
    "Call signaling payload is too large",
  ),
}).strict();
