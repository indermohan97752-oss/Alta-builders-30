import { Router, type Response } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { loadMembership, requireGroup, type RoomRequest } from "../middleware/rooms.js";
import {
  addMembers, createGroup, deleteRoom, getMembership, getOrCreateDm, getRoomDetails,
  leaveGroup, listRoomsForUser, removeMember, setMuted, setRole, updateRoom,
} from "../models/room.js";
import { createEncryptedMessage, listMessages } from "../models/message.js";
import { findPublicById } from "../models/user.js";
import {
  canAddMembers, canChangeRole, canDeleteRoom, canEditRoom, canRemoveMember,
} from "../services/permissions.js";
import { emitRoomEventToMembers, memberJoined, memberLeft, postSystemMessage, roomChanged, roomDeleted } from "../services/realtime.js";
import { sendValidationError } from "../validation/respond.js";
import {
  addMembersSchema, createRoomSchema, dmSchema, mutedSchema, objectId, roleSchema, rotationSchema, updateRoomSchema,
} from "../validation/rooms.js";
import { sendMessageEventSchema } from "../validation/socket.js";

export const roomsRouter = Router();
roomsRouter.use(requireAuth);

const forbidden = (res: Response, msg = "You don't have permission to do that") =>
  res.status(403).json({ error: msg });

const actorName = async (userId: string) => {
  const u = await findPublicById(userId);
  return u?.username ?? "Someone";
};

// ---- list / create -------------------------------------------------------

roomsRouter.get("/", async (req: AuthedRequest, res) => {
  res.json(await listRoomsForUser(req.userId!));
});

roomsRouter.post("/", async (req: AuthedRequest, res) => {
  const parsed = createRoomSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);
  try {
    const { room, addedIds } = await createGroup(req.userId!, parsed.data);
    memberJoined(room.id, [req.userId!, ...addedIds]);
    res.status(201).json(room);
  } catch (error) {
    if (error instanceof Error && error.message.includes("encrypted room key")) return res.status(400).json({ error: error.message });
    throw error;
  }
});

roomsRouter.post("/dm", async (req: AuthedRequest, res) => {
  const parsed = dmSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);
  const otherId = parsed.data.userId;
  if (otherId === req.userId) return res.status(400).json({ error: "You can't start a chat with yourself" });
  if (!(await findPublicById(otherId))) return res.status(404).json({ error: "User not found" });

  try {
    const { room, created } = await getOrCreateDm(req.userId!, otherId, parsed.data);
    if (created) memberJoined(room.id, [req.userId!, otherId]);
    res.status(created ? 201 : 200).json(room);
  } catch (error) {
    if (error instanceof Error && error.message.includes("encrypted room key")) return res.status(400).json({ error: error.message });
    throw error;
  }
});

// ---- one room ------------------------------------------------------------

roomsRouter.get("/:roomId", loadMembership, async (req: RoomRequest, res) => {
  const details = await getRoomDetails(req.params.roomId, req.userId!);
  if (!details) return res.status(404).json({ error: "Room not found" });
  res.json({ ...details, my_user_id: req.userId, my_role: req.membership!.role, is_muted: req.membership!.is_muted });
});

roomsRouter.patch("/:roomId", loadMembership, requireGroup, async (req: RoomRequest, res) => {
  if (!canEditRoom(req.membership!.role)) return forbidden(res);
  const parsed = updateRoomSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  const room = await updateRoom(req.params.roomId, req.userId!, parsed.data.encryptedMetadata);
  if (!room) return res.status(403).json({ error: "Room permissions changed; reload and retry" });
  await postSystemMessage(room.id, req.userId!, `${await actorName(req.userId!)} updated encrypted room details`);
  roomChanged(room.id);
  res.json(room);
});

roomsRouter.delete("/:roomId", loadMembership, requireGroup, async (req: RoomRequest, res) => {
  if (!canDeleteRoom(req.membership!.role)) return forbidden(res, "Only the owner can delete a room");
  const formerMemberIds = await deleteRoom(req.params.roomId, req.userId!);
  if (!formerMemberIds) return res.status(403).json({ error: "Only the current owner can delete a room" });
  roomDeleted(req.params.roomId, formerMemberIds);
  res.status(204).end();
});

// ---- members -------------------------------------------------------------

roomsRouter.post("/:roomId/members", loadMembership, requireGroup, async (req: RoomRequest, res) => {
  if (!canAddMembers(req.membership!.role)) return forbidden(res);
  const parsed = addMembersSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);

  let added: string[];
  try {
    added = await addMembers(req.params.roomId, req.userId!, parsed.data.userIds, {
      encryptedMetadata: parsed.data.encryptedMetadata, keyEnvelopes: parsed.data.keyEnvelopes,
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Key rotation")) return res.status(400).json({ error: error.message });
    throw error;
  }
  if (added.length) {
    memberJoined(req.params.roomId, added);
    await postSystemMessage(req.params.roomId, req.userId!, `${await actorName(req.userId!)} updated room membership and encryption keys`);
  }
  res.status(added.length ? 201 : 200).json({ addedIds: added });
});

roomsRouter.patch("/:roomId/members/:userId", loadMembership, requireGroup, async (req: RoomRequest, res) => {
  const { roomId, userId } = req.params;
  const parsed = roleSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);
  if (!objectId.safeParse(userId).success) return res.status(404).json({ error: "Member not found" });

  const target = await getMembership(roomId, userId);
  if (!target) return res.status(404).json({ error: "Member not found" });
  if (!canChangeRole(req.membership!.role, target.role, parsed.data.role)) {
    return forbidden(res, "Only the owner can change roles, and the owner's role can't be changed");
  }
  const changed = await setRole(roomId, req.userId!, userId, parsed.data.role);
  if (!changed) return res.status(409).json({ error: "Room permissions changed; reload and retry" });
  roomChanged(roomId);
  res.json({ userId, role: parsed.data.role });
});

// Leaving/removing members requires a new room key wrapped to every remaining
// participant. This prevents a departed member from decrypting future messages.
roomsRouter.delete("/:roomId/members/:userId", loadMembership, requireGroup, async (req: RoomRequest, res) => {
  const { roomId, userId } = req.params;
  if (!objectId.safeParse(userId).success) return res.status(404).json({ error: "Member not found" });

  const target = await getMembership(roomId, userId);
  if (!target) return res.status(404).json({ error: "Member not found" });

  if (userId === req.userId) {
    let rotation = null;
    if (target.role === "owner" || req.body && Object.keys(req.body).length) {
      const parsed = rotationSchema.safeParse(req.body);
      if (parsed.success) rotation = parsed.data;
      else if (target.role !== "owner") return sendValidationError(res, parsed.error);
    }
    try {
      const result = await leaveGroup(roomId, userId, rotation);
      if (!result.left) return res.status(404).json({ error: "Member not found" });
      memberLeft(roomId, [userId]);
      if (result.left && !result.roomDeleted) await postSystemMessage(roomId, userId, "A member left the encrypted room");
      return res.status(204).end();
    } catch (error) {
      if (error instanceof Error && error.message.includes("Room membership changed")) return res.status(409).json({ error: error.message });
      if (error instanceof Error && (error.message.includes("Key rotation") || error.message.includes("Leaving a group"))) return res.status(400).json({ error: error.message });
      throw error;
    }
  }

  if (!canRemoveMember(req.membership!.role, target.role)) return forbidden(res);
  const parsed = rotationSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);
  let removed: boolean;
  try {
    removed = await removeMember(roomId, req.userId!, userId, parsed.data);
  } catch (error) {
    if (error instanceof Error && error.message.includes("Room membership changed")) return res.status(409).json({ error: error.message });
    if (error instanceof Error && error.message.includes("Key rotation")) return res.status(400).json({ error: error.message });
    throw error;
  }
  if (!removed) return res.status(409).json({ error: "Room membership changed; reload and retry" });
  memberLeft(roomId, [userId]);
  await postSystemMessage(roomId, req.userId!, "A member was removed and room encryption keys were rotated");
  res.status(204).end();
});

// ---- per-user room settings ----------------------------------------------

roomsRouter.patch("/:roomId/me", loadMembership, async (req: RoomRequest, res) => {
  const parsed = mutedSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);
  await setMuted(req.params.roomId, req.userId!, parsed.data.isMuted);
  res.json({ isMuted: parsed.data.isMuted });
});

// ---- messages (HTTP send + cursor pagination) ------------------------------
// Sending over authenticated same-origin HTTP avoids relying on a cross-site
// WebSocket cookie, which some browsers block. Membership and key version are
// checked server-side exactly as for realtime sends.
roomsRouter.post("/:roomId/messages", loadMembership, async (req: RoomRequest, res) => {
  const parsed = sendMessageEventSchema.safeParse(req.body);
  if (!parsed.success) return sendValidationError(res, parsed.error);
  const { roomId, encryptedContent, encryptedIv, keyVersion, replyToId } = parsed.data;
  if (roomId !== req.params.roomId) return res.status(400).json({ error: "Room mismatch" });
  if (req.membership!.current_key_version !== keyVersion) return res.status(409).json({ error: "The room encryption key changed. Reload the room before sending." });
  const message = await createEncryptedMessage({ room: roomId, sender: req.userId!, encryptedContent, encryptedIv, keyVersion, replyTo: replyToId ?? null });
  await emitRoomEventToMembers(roomId, "message:new", message);
  res.status(201).json(message);
});

roomsRouter.get("/:roomId/messages", loadMembership, async (req: RoomRequest, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 30) || 30, 1), 100);
  const before = typeof req.query.before === "string" && /^[a-f0-9]{24}$/i.test(req.query.before) ? req.query.before : null;

  res.json(await listMessages(req.params.roomId, before, limit));
});
