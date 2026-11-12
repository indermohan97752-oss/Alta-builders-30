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
