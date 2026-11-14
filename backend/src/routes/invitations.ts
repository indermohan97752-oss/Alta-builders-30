import { createHash, randomBytes } from "node:crypto";
import { Router } from "express";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { GroupInvitationModel, RoomModel, UserModel } from "../models/schemas.js";
import { memberJoined, postSystemMessage, roomChanged } from "../services/realtime.js";
import { objectId, encryptedBlob, keyEnvelope } from "../validation/rooms.js";
import { z } from "zod";

export const invitationsRouter = Router();
invitationsRouter.use(requireAuth);

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{40,60}$/);
const rotationSchema = z.object({
  encryptedMetadata: encryptedBlob,
  keyEnvelopes: z.array(keyEnvelope).min(1).max(100).refine((items) => new Set(items.map((item) => item.userId)).size === items.length),
}).strict();

async function applyInviteJoin(invite: any, userId: string, rotation: z.infer<typeof rotationSchema>) {
  const room = await RoomModel.findById(invite.room).select("type members currentKeyVersion membershipRevision").lean() as any;
  if (!room || room.type !== "group") return { status: 404 as const, error: "Group not found" };
  if (room.members.some((m: any) => String(m.user) === userId)) return { status: 200 as const, alreadyMember: true };
  const resultingIds = [...room.members.map((m: any) => String(m.user)), userId].sort();
  const envelopeMap = new Map(rotation.keyEnvelopes.map((entry) => [entry.userId, entry.wrappedKey]));
  if (resultingIds.length !== envelopeMap.size || resultingIds.some((id) => !envelopeMap.has(id))) {
    return { status: 400 as const, error: "The key rotation must include exactly one encrypted key for every current member and the joining member." };
  }
  const nextVersion = Number(room.currentKeyVersion ?? 1) + 1;
  const result = await RoomModel.updateOne(
    {
      _id: room._id,
      type: "group",
      currentKeyVersion: room.currentKeyVersion,
      membershipRevision: room.membershipRevision ?? 0,
      "members.user": { $ne: userId },
    },
    {
      $push: {
        members: { user: userId, role: "member", joinedAt: new Date() },
        keyEnvelopes: { $each: resultingIds.map((id) => ({ user: id, wrappedKey: envelopeMap.get(id), keyVersion: nextVersion })) },
      },
      $set: { currentKeyVersion: nextVersion, encryptedMetadata: rotation.encryptedMetadata },
      $inc: { membershipRevision: 1 },
    },
  );
  if (!result.modifiedCount) return { status: 409 as const, error: "Group membership changed. Refresh and try again." };
  await GroupInvitationModel.updateMany({ room: room._id }, { $pull: { requests: { user: userId } } });
  memberJoined(String(room._id), [userId]);
  await postSystemMessage(String(room._id), userId, "A member joined using a group invitation. Encryption keys were rotated.");
  roomChanged(String(room._id));
  return { status: 201 as const, joined: true, keyVersion: nextVersion };
}

invitationsRouter.post("/rooms/:roomId/invitations", async (req: AuthedRequest, res) => {
  const { roomId } = req.params;
  if (!objectId.safeParse(roomId).success) return res.status(404).json({ error: "Group not found" });
  const body = z.object({ mode: z.enum(["approval", "instant"]), displayName: z.string().trim().min(1).max(60) }).strict().safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid invitation settings" });
  const room = await RoomModel.findOne({ _id: roomId, type: "group", members: { $elemMatch: { user: req.userId, role: { $in: ["owner", "admin"] } } } }).select("_id").lean();
  if (!room) return res.status(403).json({ error: "Only group owners and admins can create invitations" });
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const created = await GroupInvitationModel.create({ tokenHash: tokenHash(token), room: roomId, createdBy: req.userId, mode: body.data.mode, displayName: body.data.displayName, expiresAt });
  res.status(201).json({ token, invitationId: String(created._id), mode: body.data.mode, expiresAt });
});

invitationsRouter.get("/:token", async (req: AuthedRequest, res) => {
  const parsed = tokenSchema.safeParse(req.params.token);
  if (!parsed.success) return res.status(404).json({ error: "Invitation not found" });
  const invite = await GroupInvitationModel.findOne({ tokenHash: tokenHash(parsed.data), revokedAt: null, expiresAt: { $gt: new Date() } }).lean() as any;
  if (!invite) return res.status(404).json({ error: "This invitation is invalid, expired or revoked." });
  const room = await RoomModel.findById(invite.room).select("type members currentKeyVersion membershipRevision").lean() as any;
  if (!room || room.type !== "group") return res.status(404).json({ error: "Group not found" });
  const alreadyMember = room.members.some((m: any) => String(m.user) === req.userId);
  const requested = (invite.requests ?? []).some((r: any) => String(r.user) === req.userId);
  res.json({
    roomId: String(room._id), displayName: invite.displayName, mode: invite.mode,
    memberIds: room.members.map((m: any) => String(m.user)),
    currentKeyVersion: room.currentKeyVersion, alreadyMember, requested,
  });
});

invitationsRouter.post("/:token/join", async (req: AuthedRequest, res) => {
  const parsedToken = tokenSchema.safeParse(req.params.token);
  if (!parsedToken.success) return res.status(404).json({ error: "Invitation not found" });
  const invite = await GroupInvitationModel.findOne({ tokenHash: tokenHash(parsedToken.data), revokedAt: null, expiresAt: { $gt: new Date() } }).lean() as any;
  if (!invite) return res.status(404).json({ error: "This invitation is invalid, expired or revoked." });
  const room = await RoomModel.findById(invite.room).select("members").lean() as any;
  if (!room) return res.status(404).json({ error: "Group not found" });
  if (room.members.some((m: any) => String(m.user) === req.userId)) return res.json({ status: "member" });

  if (invite.mode === "approval") {
    await GroupInvitationModel.updateOne(
      { _id: invite._id, revokedAt: null, expiresAt: { $gt: new Date() }, "requests.user": { $ne: req.userId } },
      { $push: { requests: { user: req.userId, requestedAt: new Date() } } },
    );
    return res.status(202).json({ status: "requested" });
  }
  const rotation = rotationSchema.safeParse(req.body);
  if (!rotation.success) return res.status(400).json({ error: "A valid end-to-end encryption key rotation is required to join." });
  const result = await applyInviteJoin(invite, req.userId!, rotation.data);
  return res.status(result.status).json(result);
});

invitationsRouter.get("/rooms/:roomId/requests", async (req: AuthedRequest, res) => {
  const { roomId } = req.params;
  const room = await RoomModel.findOne({ _id: roomId, type: "group", members: { $elemMatch: { user: req.userId, role: { $in: ["owner", "admin"] } } } }).select("_id").lean();
  if (!room) return res.status(403).json({ error: "Only group owners and admins can view join requests" });
  const invites = await GroupInvitationModel.find({ room: roomId, mode: "approval", revokedAt: null, expiresAt: { $gt: new Date() }, "requests.0": { $exists: true } }).select("requests").lean() as any[];
  const ids = invites.flatMap((invite) => invite.requests.map((request: any) => request.user));
  const users = await UserModel.find({ _id: { $in: ids } }).select("username status").lean() as any[];
  const byId = new Map(users.map((user) => [String(user._id), user]));
  res.json(invites.flatMap((invite) => invite.requests.map((request: any) => ({
    user_id: String(request.user), username: byId.get(String(request.user))?.username ?? "Unknown user",
    status: byId.get(String(request.user))?.status ?? "offline", requested_at: request.requestedAt,
  }))));
});

invitationsRouter.post("/rooms/:roomId/requests/:userId/approve", async (req: AuthedRequest, res) => {
  const { roomId, userId } = req.params;
  if (!objectId.safeParse(roomId).success || !objectId.safeParse(userId).success) return res.status(404).json({ error: "Request not found" });
  const room = await RoomModel.findOne({ _id: roomId, type: "group", members: { $elemMatch: { user: req.userId, role: { $in: ["owner", "admin"] } } } }).select("members").lean() as any;
  if (!room) return res.status(403).json({ error: "Only group owners and admins can approve requests" });
  const invite = await GroupInvitationModel.findOne({ room: roomId, mode: "approval", revokedAt: null, expiresAt: { $gt: new Date() }, "requests.user": userId }).lean() as any;
  if (!invite) return res.status(404).json({ error: "Join request not found or invitation expired" });
  const rotation = rotationSchema.safeParse(req.body);
  if (!rotation.success) return res.status(400).json({ error: "A valid end-to-end encryption key rotation is required." });
  const result = await applyInviteJoin(invite, userId, rotation.data);
  return res.status(result.status).json(result);
});

invitationsRouter.delete("/rooms/:roomId/invitations/:invitationId", async (req: AuthedRequest, res) => {
  const { roomId, invitationId } = req.params;
  if (!objectId.safeParse(roomId).success || !objectId.safeParse(invitationId).success) return res.status(404).json({ error: "Invitation not found" });
  const room = await RoomModel.findOne({ _id: roomId, type: "group", members: { $elemMatch: { user: req.userId, role: { $in: ["owner", "admin"] } } } }).select("_id").lean();
  if (!room) return res.status(403).json({ error: "Only group owners and admins can revoke invitations" });
  const result = await GroupInvitationModel.updateOne({ _id: invitationId, room: roomId, revokedAt: null }, { $set: { revokedAt: new Date() } });
  if (!result.modifiedCount) return res.status(404).json({ error: "Invitation not found" });
  res.status(204).end();
});
