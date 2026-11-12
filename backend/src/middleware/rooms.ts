import type { NextFunction, Response } from "express";
import type { AuthedRequest } from "./auth.js";
import { getMembership, type Membership } from "../models/room.js";
import { objectId } from "../validation/rooms.js";

export interface RoomRequest extends AuthedRequest {
  membership?: Membership;
}

/** Non-members get 404, so room ids can't be probed. */
export async function loadMembership(req: RoomRequest, res: Response, next: NextFunction) {
  const roomId = req.params.roomId;
  if (!objectId.safeParse(roomId).success) return res.status(404).json({ error: "Room not found" });
  const membership = await getMembership(roomId, req.userId!);
  if (!membership) return res.status(404).json({ error: "Room not found" });
  req.membership = membership;
  next();
}

export function requireGroup(req: RoomRequest, res: Response, next: NextFunction) {
  if (req.membership?.type !== "group") {
    return res.status(400).json({ error: "This action isn't available for direct chats" });
  }
  next();
}
