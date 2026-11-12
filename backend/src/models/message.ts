import { MessageModel, UserModel } from "./schemas.js";
import { toMessage } from "./serializers.js";

export async function listMessages(roomId: string, before: string | null, limit: number) {
  const filter: Record<string, unknown> = { room: roomId, deletedAt: null };
  if (before) filter._id = { $lt: before };
  const rows = (await MessageModel.find(filter).sort({ _id: -1 }).limit(limit).populate("sender", "username").lean()) as any[];
  return rows.reverse().map((m) => toMessage(m));
}

export async function createEncryptedMessage(input: {
  room: string;
  sender: string;
  encryptedContent: string;
  encryptedIv: string;
  keyVersion: number;
  replyTo?: string | null;
}) {
  let replyTo: string | null = input.replyTo ?? null;
  if (replyTo && !(await MessageModel.exists({ _id: replyTo, room: input.room }))) replyTo = null;
  const doc = await MessageModel.create({
    room: input.room,
    sender: input.sender,
    type: "text",
    encryptedContent: input.encryptedContent,
    encryptedIv: input.encryptedIv,
    encryptionVersion: input.keyVersion,
    replyTo,
  });
  const sender = await UserModel.findById(input.sender).select("username").lean();
  return toMessage(doc, sender);
}

/** System notices are intentionally non-sensitive operational messages only. */
export async function createSystemMessage(input: { room: string; sender: string; content: string }) {
  const doc = await MessageModel.create({ room: input.room, sender: input.sender, type: "system", content: input.content });
  const sender = await UserModel.findById(input.sender).select("username").lean();
  return toMessage(doc, sender);
}
