import type { Server } from "socket.io";
import { createSystemMessage } from "../models/message.js";
import { RoomModel } from "../models/schemas.js";

let io: Server | undefined;
export const setIo = (server: Server) => { io = server; };

/** Revoke already-open realtime sessions when the account logs out. */
export function disconnectUserSockets(userId: string) {
  io?.in(`user:${userId}`).disconnectSockets(true);
}

/**
 * Deliver room events to personal channels for the members currently recorded
 * in MongoDB. A stale Socket.IO room subscription is never treated as proof of
 * continuing membership for private room events.
 */
export async function emitRoomEventToMembers(roomId: string, event: string, payload: unknown, excludeUserId?: string) {
  if (!io) return;
  const room = await RoomModel.findById(roomId).select("members.user").lean() as any;
  if (!room) return;
  const recipients = room.members
    .map((member: any) => String(member.user))
    .filter((userId: string) => userId !== excludeUserId)
    .map((userId: string) => `user:${userId}`);
  if (recipients.length) io.to(recipients).emit(event, payload);
}

/** Put live sockets into the room and tell the clients. */
export function memberJoined(roomId: string, userIds: string[]) {
  for (const id of userIds) {
    io?.in(`user:${id}`).socketsJoin(roomId);
    io?.to(`user:${id}`).emit("room:added", { roomId });
  }
  void emitRoomEventToMembers(roomId, "room:updated", { roomId }).catch(() => undefined);
}

export function memberLeft(roomId: string, userIds: string[]) {
  for (const id of userIds) {
    io?.to(`user:${id}`).emit("room:removed", { roomId });
    io?.in(`user:${id}`).socketsLeave(roomId);
  }
  void emitRoomEventToMembers(roomId, "room:updated", { roomId }).catch(() => undefined);
}

export function roomDeleted(roomId: string, formerMemberIds: string[]) {
  for (const id of formerMemberIds) {
    io?.to(`user:${id}`).emit("room:removed", { roomId });
    io?.in(`user:${id}`).socketsLeave(roomId);
  }
}

export const roomChanged = (roomId: string) => {
  void emitRoomEventToMembers(roomId, "room:updated", { roomId }).catch(() => undefined);
};

/** System notices are operational, non-sensitive messages only. */
export async function postSystemMessage(roomId: string, actorId: string, content: string) {
  const msg = await createSystemMessage({ room: roomId, sender: actorId, content });
  await emitRoomEventToMembers(roomId, "message:new", msg);
}
