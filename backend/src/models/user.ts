import { Types } from "mongoose";
import { MessageModel, RoomModel, UserModel } from "./schemas.js";
import { toPublicUser, toUserLite } from "./serializers.js";

export interface NewUser {
  username: string;
  passwordHash: string;
  cryptoPublicKey: Record<string, unknown>;
  cryptoSalt: string;
  wrappedPrivateKey: { iv: string; ciphertext: string; iterations: number };
  encryptedProfile: { iv: string; ciphertext: string };
}

const validId = (id: string) => Types.ObjectId.isValid(id) && String(new Types.ObjectId(id)) === id;

export async function createUser(input: NewUser) {
  const doc = await UserModel.create(input);
  return { ...toPublicUser(doc), session_version: Number(doc.sessionVersion ?? 0) };
}

export async function findTaken(username: string): Promise<boolean> {
  return Boolean(await UserModel.exists({ usernameLower: username.toLowerCase() }));
}

export async function findCredentialsByUsername(username: string) {
  const row = await UserModel.findOne({ usernameLower: username.toLowerCase() }).select("+passwordHash").lean();
  if (!row) return null;
  return {
    ...toPublicUser(row),
    password_hash: row.passwordHash as string,
    session_version: Number(row.sessionVersion ?? 0),
    crypto_salt: row.cryptoSalt as string,
    crypto_public_key: row.cryptoPublicKey as Record<string, unknown>,
    wrapped_private_key: row.wrappedPrivateKey as { iv: string; ciphertext: string; iterations: number },
    encrypted_profile: row.encryptedProfile as { iv: string; ciphertext: string },
  };
}

export const isUniqueViolation = (err: unknown) => (err as { code?: number } | null)?.code === 11000;

export async function findPublicById(id: string) {
  if (!validId(id)) return null;
  const row = await UserModel.findById(id).select("username status createdAt").lean();
  return row ? toPublicUser(row) : null;
}

export async function findOwnById(id: string) {
  if (!validId(id)) return null;
  const row = await UserModel.findById(id).select("username status createdAt cryptoSalt cryptoPublicKey wrappedPrivateKey encryptedProfile").lean();
  if (!row) return null;
  return {
    ...toPublicUser(row),
    crypto_salt: row.cryptoSalt,
    crypto_public_key: row.cryptoPublicKey,
    wrapped_private_key: row.wrappedPrivateKey,
    encrypted_profile: row.encryptedProfile,
  };
}

export async function getCryptoPublicKey(id: string) {
  if (!validId(id)) return null;
  const row = await UserModel.findById(id).select("cryptoPublicKey username").lean();
  return row ? { id: String(row._id), username: row.username, public_key: row.cryptoPublicKey } : null;
}

export async function displayNames(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await UserModel.find({ _id: { $in: ids } }).sort({ usernameLower: 1 }).select("username").lean();
  return rows.map((r) => r.username as string);
}

export async function searchUsers(q: string, excludeId: string) {
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rows = await UserModel.find({ _id: { $ne: excludeId }, usernameLower: { $regex: escaped.toLowerCase() } })
    .sort({ usernameLower: 1 }).limit(10).select("username status").lean();
  return rows.map(toUserLite);
}

export async function updateEncryptedProfile(id: string, encryptedProfile: { iv: string; ciphertext: string }) {
  await UserModel.updateOne({ _id: id }, { $set: { encryptedProfile } });
  return findOwnById(id);
}

export async function getStats(userId: string) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const [rooms, sentToday] = await Promise.all([
    RoomModel.countDocuments({ "members.user": userId }),
    MessageModel.countDocuments({ sender: userId, type: { $ne: "system" }, createdAt: { $gte: startOfDay } }),
  ]);
  return { rooms, sent_today: sentToday };
}

export const setStatus = (id: string, status: "online" | "away" | "offline") =>
  UserModel.updateOne({ _id: id }, { $set: { status, ...(status === "offline" ? { lastSeenAt: new Date() } : {}) } });

export async function sessionVersionMatches(id: string, version: number): Promise<boolean> {
  if (!validId(id) || !Number.isInteger(version) || version < 0) return false;
  const row = await UserModel.findById(id).select("sessionVersion").lean();
  return Boolean(row && Number(row.sessionVersion ?? 0) === version);
}

export async function revokeAllSessions(id: string): Promise<void> {
  if (!validId(id)) return;
  await UserModel.updateOne({ _id: id }, { $inc: { sessionVersion: 1 } });
}
