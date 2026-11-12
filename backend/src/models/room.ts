import { Types } from "mongoose";
import type { Role } from "../services/permissions.js";
import { MessageModel, RoomModel, UserModel } from "./schemas.js";
import { toRoom } from "./serializers.js";
import { isUniqueViolation } from "./user.js";

interface MemberDoc {
  user: Types.ObjectId;
  role: Role;
  joinedAt: Date;
  lastReadMessageId?: Types.ObjectId | null;
  isMuted: boolean;
}
interface RoomDoc {
  _id: Types.ObjectId;
  type: "direct" | "group";
  encryptedMetadata: { iv: string; ciphertext: string };
  keyEnvelopes: Array<{ user: Types.ObjectId; wrappedKey: string; keyVersion: number }>;
  currentKeyVersion: number;
  membershipRevision: number;
  createdBy?: Types.ObjectId;
  createdAt: Date;
  members: MemberDoc[];
}

export interface Membership {
  role: Role;
  type: "direct" | "group";
  is_muted: boolean;
}

const asRoom = (x: unknown) => x as RoomDoc;
const roleOrder: Record<Role, number> = { owner: 0, admin: 1, member: 2 };
const idStr = (x: unknown) => String(x);

export async function getMembership(roomId: string, userId: string): Promise<Membership | null> {
  const room = await RoomModel.findOne({ _id: roomId, "members.user": userId }).select("type members").lean();
  if (!room) return null;
  const me = asRoom(room).members.find((m) => idStr(m.user) === userId)!;
  return { role: me.role, type: room.type as "direct" | "group", is_muted: me.isMuted };
}

/** Room list returns encrypted metadata and only this member's room-key envelope. */
export async function listRoomsForUser(userId: string) {
  const rooms = (await RoomModel.find({ "members.user": userId }).lean()) as unknown as RoomDoc[];
  const rows = await Promise.all(rooms.map(async (r) => {
    const me = r.members.find((m) => idStr(m.user) === userId)!;
    const last = (await MessageModel.findOne({ room: r._id, deletedAt: null })
      .sort({ _id: -1 }).populate("sender", "username").lean()) as any;
    const unreadFilter: Record<string, unknown> = { room: r._id, deletedAt: null, sender: { $ne: userId } };
    if (me.lastReadMessageId) unreadFilter._id = { $gt: me.lastReadMessageId };
    const unread = await MessageModel.countDocuments(unreadFilter);
    return {
      id: idStr(r._id),
      type: r.type,
      encrypted_metadata: r.encryptedMetadata,
      key_envelopes: r.keyEnvelopes?.filter((item) => idStr(item.user) === userId).map((item) => ({ key_version: item.keyVersion, wrapped_key: item.wrappedKey })) ?? [],
      current_key_version: r.currentKeyVersion,
      role: me.role,
      is_muted: me.isMuted,
      last_content: last?.type === "system" ? last.content : (last ? "Encrypted message" : null),
      last_type: last?.type ?? null,
      last_at: last?.createdAt ?? null,
      last_sender: last?.sender?.username ?? null,
      unread,
      sortKey: last?.createdAt ?? r.createdAt,
    };
  }));
  rows.sort((a, b) => +new Date(b.sortKey) - +new Date(a.sortKey));
  return rows.map(({ sortKey: _omit, ...rest }) => rest);
}

export async function getRoomDetails(roomId: string, viewerId: string) {
  const room = (await RoomModel.findById(roomId).lean()) as unknown as RoomDoc | null;
  if (!room) return null;
  const users = await UserModel.find({ _id: { $in: room.members.map((m) => m.user) } }).select("username status").lean();
  const byId = new Map(users.map((u) => [idStr(u._id), u]));
  const members = room.members.map((m) => {
    const u: any = byId.get(idStr(m.user)) ?? {};
    return { user_id: idStr(m.user), username: u.username as string, status: (u.status ?? "offline") as "online" | "away" | "offline", role: m.role, joined_at: m.joinedAt };
  }).sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || +new Date(a.joined_at) - +new Date(b.joined_at));
  return {
    ...toRoom(room), members,
    key_envelopes: room.keyEnvelopes?.filter((item) => idStr(item.user) === viewerId).map((item) => ({ key_version: item.keyVersion, wrapped_key: item.wrappedKey })) ?? [],
    current_key_version: room.currentKeyVersion,
  };
}

export async function createGroup(
  creatorId: string,
  input: { memberIds: string[]; encryptedMetadata: { iv: string; ciphertext: string }; keyEnvelopes: Array<{ userId: string; wrappedKey: string }> },
) {
  const valid = await UserModel.find({ _id: { $in: input.memberIds, $ne: creatorId } }).select("_id").lean();
  const memberIds = [creatorId, ...valid.map((u) => idStr(u._id))];
  const envelopes = new Map(input.keyEnvelopes.map((e) => [e.userId, e.wrappedKey]));
  if (memberIds.some((id) => !envelopes.has(id)) || input.keyEnvelopes.some((e) => !memberIds.includes(e.userId))) {
    throw new Error("A valid encrypted room key must be supplied for every room member");
  }
  const room = await RoomModel.create({
    type: "group", encryptedMetadata: input.encryptedMetadata, createdBy: creatorId,
    members: [{ user: creatorId, role: "owner" }, ...valid.map((u) => ({ user: u._id, role: "member" }))],
    keyEnvelopes: memberIds.map((id) => ({ user: id, wrappedKey: envelopes.get(id), keyVersion: 1 })),
    currentKeyVersion: 1,
  });
  return { room: toRoom(room), addedIds: valid.map((u) => idStr(u._id)) };
}

export async function getOrCreateDm(
  userId: string,
  otherId: string,
  input: { encryptedMetadata: { iv: string; ciphertext: string }; keyEnvelopes: Array<{ userId: string; wrappedKey: string }> },
) {
  const dmKey = [userId, otherId].sort().join(":");
  const existing = await RoomModel.findOne({ dmKey }).lean();
  if (existing) return { room: toRoom(existing), created: false };
  const expected = [userId, otherId].sort();
  const actual = input.keyEnvelopes.map((e) => e.userId).sort();
  if (expected.length !== actual.length || expected.some((id, index) => id !== actual[index])) {
    throw new Error("A valid encrypted room key must be supplied for both participants");
  }
  try {
    const room = await RoomModel.create({
      type: "direct", dmKey, createdBy: userId, encryptedMetadata: input.encryptedMetadata,
      keyEnvelopes: input.keyEnvelopes.map((e) => ({ user: e.userId, wrappedKey: e.wrappedKey, keyVersion: 1 })),
      currentKeyVersion: 1,
      members: [{ user: userId }, { user: otherId }],
    });
    return { room: toRoom(room), created: true };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const raced = await RoomModel.findOne({ dmKey }).lean();
    return { room: toRoom(raced), created: false };
  }
}

export async function updateRoom(roomId: string, actorId: string, encryptedMetadata: { iv: string; ciphertext: string }) {
  const row = await RoomModel.findOneAndUpdate(
    { _id: roomId, members: { $elemMatch: { user: actorId, role: { $in: ["owner", "admin"] } } } },
    { $set: { encryptedMetadata } },
    { new: true, runValidators: true },
  ).lean();
  return row ? toRoom(row) : null;
}

export async function deleteRoom(roomId: string, actorId: string): Promise<string[] | null> {
  // Authorization is part of the delete predicate to close the gap between a
  // middleware role check and the actual write. Return former members so the
  // removal event can be delivered through their private user channels.
  const deleted = await RoomModel.findOneAndDelete({
    _id: roomId,
    members: { $elemMatch: { user: actorId, role: "owner" } },
  }).lean() as any;
  if (!deleted) return null;
  await MessageModel.deleteMany({ room: roomId });
  return deleted.members.map((member: any) => idStr(member.user));
}

/** Add members and rotate the room key atomically. All resulting members need an envelope for the new version. */
export async function addMembers(
  roomId: string,
  actorId: string,
  userIds: string[],
  rotation: { encryptedMetadata: { iv: string; ciphertext: string }; keyEnvelopes: Array<{ userId: string; wrappedKey: string }> },
): Promise<string[]> {
  const room = await RoomModel.findById(roomId).select("members currentKeyVersion membershipRevision").lean() as any;
  if (!room) return [];
  const current = new Set(room.members.map((m: any) => idStr(m.user)));
  const candidates = userIds.filter((id) => !current.has(id));
  const users = await UserModel.find({ _id: { $in: candidates } }).select("_id").lean();
  const toAdd = users.map((u) => u._id);
  if (!toAdd.length) return [];
  const resultingIds = [...current, ...toAdd.map(idStr)].sort();
  const envelopeMap = new Map(rotation.keyEnvelopes.map((e) => [e.userId, e.wrappedKey]));
  if (resultingIds.length !== envelopeMap.size || resultingIds.some((id) => !envelopeMap.has(id))) {
    throw new Error("Key rotation must include one encrypted key for every current and new member");
  }
  const nextVersion = Number(room.currentKeyVersion ?? 1) + 1;
  const res = await RoomModel.updateOne(
    {
      _id: roomId,
      currentKeyVersion: room.currentKeyVersion,
      membershipRevision: room.membershipRevision ?? 0,
      members: { $elemMatch: { user: actorId, role: { $in: ["owner", "admin"] } } },
    },
    {
      $push: {
        members: { $each: toAdd.map((id) => ({ user: id, role: "member", joinedAt: new Date() })) },
        keyEnvelopes: { $each: resultingIds.map((id) => ({ user: id, wrappedKey: envelopeMap.get(id), keyVersion: nextVersion })) },
      },
      $set: { currentKeyVersion: nextVersion, encryptedMetadata: rotation.encryptedMetadata },
      $inc: { membershipRevision: 1 },
    },
  );
  return res.modifiedCount ? toAdd.map(idStr) : [];
}

/** Remove a member and rotate keys so they cannot read future messages. */
export async function removeMember(
  roomId: string,
  actorId: string,
  userId: string,
  rotation: { encryptedMetadata: { iv: string; ciphertext: string }; keyEnvelopes: Array<{ userId: string; wrappedKey: string }> },
): Promise<boolean> {
  const room = await RoomModel.findById(roomId).select("members keyEnvelopes currentKeyVersion membershipRevision").lean() as any;
  if (!room) return false;
  const target = room.members.find((m: any) => idStr(m.user) === userId);
  if (!target) return false;
  const actor = room.members.find((m: any) => idStr(m.user) === actorId);
  const rank: Record<string, number> = { owner: 3, admin: 2, member: 1 };
  if (!actor || !target || rank[actor.role] <= rank[target.role]) return false;

  const remainingMembers = room.members.filter((m: any) => idStr(m.user) !== userId);
  const remainingIds = remainingMembers.map((m: any) => idStr(m.user)).sort();
  const envelopeMap = new Map(rotation.keyEnvelopes.map((e) => [e.userId, e.wrappedKey]));
  if (!remainingIds.length || remainingIds.length !== envelopeMap.size || remainingIds.some((id) => !envelopeMap.has(id))) {
    throw new Error("Key rotation must include one encrypted key for every remaining member");
  }
  const nextVersion = Number(room.currentKeyVersion ?? 1) + 1;
  // Replace keyEnvelopes in a single atomic $set. MongoDB rejects a single
  // update that both $pulls and $pushes the same array path.
  const nextEnvelopes = [
    ...room.keyEnvelopes.filter((e: any) => idStr(e.user) !== userId),
    ...remainingIds.map((id) => ({ user: id, wrappedKey: envelopeMap.get(id), keyVersion: nextVersion })),
  ];
  const targetFilter = actor.role === "owner"
    ? { "members.user": userId }
    : { members: { $elemMatch: { user: userId, role: "member" } } };
  const res = await RoomModel.updateOne(
    {
      _id: roomId,
      currentKeyVersion: room.currentKeyVersion,
      membershipRevision: room.membershipRevision ?? 0,
      $and: [
        { members: { $elemMatch: { user: actorId, role: actor.role } } },
        targetFilter,
      ],
    },
    { $set: { members: remainingMembers, keyEnvelopes: nextEnvelopes, currentKeyVersion: nextVersion, encryptedMetadata: rotation.encryptedMetadata }, $inc: { membershipRevision: 1 } },
    { runValidators: true },
  );
  return res.modifiedCount > 0;
}

export async function setRole(roomId: string, actorId: string, userId: string, role: "admin" | "member"): Promise<boolean> {
  const res = await RoomModel.updateOne(
    {
      _id: roomId,
      $and: [
        { members: { $elemMatch: { user: actorId, role: "owner" } } },
        { members: { $elemMatch: { user: userId, role: { $ne: "owner" } } } },
      ],
    },
    { $set: { "members.$[target].role": role }, $inc: { membershipRevision: 1 } },
    { arrayFilters: [{ "target.user": userId, "target.role": { $ne: "owner" } }] },
  );
  return res.modifiedCount > 0;
}

export const setMuted = (roomId: string, userId: string, isMuted: boolean) =>
  RoomModel.updateOne({ _id: roomId, "members.user": userId }, { $set: { "members.$.isMuted": isMuted }, $inc: { membershipRevision: 1 } });

/** Moves the read marker forward only, never backward. */
export const markRead = (roomId: string, userId: string, messageId: string) =>
  RoomModel.updateOne(
    {
      _id: roomId,
      members: {
        $elemMatch: { user: userId, $or: [{ lastReadMessageId: null }, { lastReadMessageId: { $lt: messageId } }] },
      },
    },
    { $set: { "members.$.lastReadMessageId": messageId }, $inc: { membershipRevision: 1 } },
  );

/**
 * Leave a group. If the owner leaves, ownership passes to the longest-standing admin
 * (or member). If nobody remains, the room is deleted.
 */
export async function leaveGroup(
  roomId: string,
  userId: string,
  rotation: { encryptedMetadata: { iv: string; ciphertext: string }; keyEnvelopes: Array<{ userId: string; wrappedKey: string }> } | null,
) {
  const room = await RoomModel.findById(roomId).select("members keyEnvelopes currentKeyVersion membershipRevision encryptedMetadata").lean() as any;
  if (!room) return { left: false as const };
  const departing = room.members.find((m: any) => idStr(m.user) === userId);
  if (!departing) return { left: false as const };
  const remainingMembers = room.members.filter((m: any) => idStr(m.user) !== userId);

  if (!remainingMembers.length) {
    const deleted = await RoomModel.deleteOne({
      _id: roomId,
      currentKeyVersion: room.currentKeyVersion,
      membershipRevision: room.membershipRevision ?? 0,
      members: { $size: 1 },
      "members.user": userId,
    });
    if (!deleted.deletedCount) throw new Error("Room membership changed; reload and retry");
    await MessageModel.deleteMany({ room: roomId });
    return { left: true as const, roomDeleted: true, newOwnerId: null as string | null };
  }

  if (!rotation) throw new Error("Leaving a group requires rotating its encryption key");
  const remainingIds = remainingMembers.map((m: any) => idStr(m.user)).sort();
  const envelopeMap = new Map(rotation.keyEnvelopes.map((e) => [e.userId, e.wrappedKey]));
  if (remainingIds.length !== envelopeMap.size || remainingIds.some((id) => !envelopeMap.has(id))) {
    throw new Error("Key rotation must include one encrypted key for every remaining member");
  }

  let newOwnerId: string | null = null;
  if (departing.role === "owner") {
    const next = [...remainingMembers].sort(
      (a: any, b: any) => Number(b.role === "admin") - Number(a.role === "admin") || +new Date(a.joinedAt) - +new Date(b.joinedAt),
    )[0] as any;
    next.role = "owner";
    newOwnerId = idStr(next.user);
  }
  const nextVersion = Number(room.currentKeyVersion ?? 1) + 1;
  const nextEnvelopes = [
    ...room.keyEnvelopes.filter((e: any) => idStr(e.user) !== userId),
    ...remainingIds.map((id) => ({ user: id, wrappedKey: envelopeMap.get(id), keyVersion: nextVersion })),
  ];
  const updated = await RoomModel.updateOne(
    { _id: roomId, currentKeyVersion: room.currentKeyVersion, membershipRevision: room.membershipRevision ?? 0, "members.user": userId },
    { $set: { members: remainingMembers, keyEnvelopes: nextEnvelopes, currentKeyVersion: nextVersion, encryptedMetadata: rotation.encryptedMetadata }, $inc: { membershipRevision: 1 } },
    { runValidators: true },
  );
  if (!updated.modifiedCount) throw new Error("Room membership changed; reload and retry");
  return { left: true as const, roomDeleted: false, newOwnerId };
}
