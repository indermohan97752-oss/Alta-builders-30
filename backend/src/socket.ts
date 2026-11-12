import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { config } from "./config.js";
import { readCookie, SESSION_COOKIE, verifyToken } from "./middleware/auth.js";
import { createEncryptedMessage } from "./models/message.js";
import { markRead } from "./models/room.js";
import { MessageModel, RoomModel } from "./models/schemas.js";
import { sessionVersionMatches, setStatus } from "./models/user.js";
import { emitRoomEventToMembers, setIo } from "./services/realtime.js";
import { readMessageEventSchema, sendMessageEventSchema, typingEventSchema } from "./validation/socket.js";

const rateLimitMessage = { error: "Too many realtime events. Slow down and try again." };

type RateWindow = { startedAt: number; count: number };
const eventWindows = new Map<string, RateWindow>();
const handshakeWindows = new Map<string, RateWindow>();

function allowHandshake(address: string) {
  const now = Date.now();
  if (handshakeWindows.size > 10_000) {
    for (const [key, value] of handshakeWindows) if (now - value.startedAt >= 60_000) handshakeWindows.delete(key);
  }
  const current = handshakeWindows.get(address);
  if (!current || now - current.startedAt >= 60_000) {
    handshakeWindows.set(address, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= 30;
}

function allowUserEvent(userId: string, name: string, max: number, windowMs: number) {
  const now = Date.now();
  const key = `${userId}:${name}`;
  const current = eventWindows.get(key);
  if (!current || now - current.startedAt >= windowMs) {
    eventWindows.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= max;
}

export function attachSocket(httpServer: HttpServer) {
  const io = new Server(httpServer, {
    cors: { origin: config.clientOrigin, credentials: true },
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      const address = req.socket.remoteAddress ?? "unknown";
      const originAllowed = origin ? origin === config.clientOrigin : config.env !== "production";
      callback(null, originAllowed && allowHandshake(address));
    },
    maxHttpBufferSize: 64 * 1024,
  });
  setIo(io);

  io.use(async (socket, next) => {
    try {
      const token = readCookie(socket.handshake.headers.cookie, SESSION_COOKIE);
      const session = token ? verifyToken(token) : null;
      if (!session || !(await sessionVersionMatches(session.userId, session.sessionVersion))) {
        return next(new Error("Unauthorized"));
      }
      socket.data.userId = session.userId;
      socket.data.sessionVersion = session.sessionVersion;
      socket.data.expiresAt = session.expiresAt;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const userId: string = socket.data.userId;
    // A socket can outlive its original HTTP handshake. Recheck expiry and the
    // revocation counter for each packet, not only when the socket connects.
    socket.use((packet, next) => {
      void (async () => {
        const valid = Date.now() < Number(socket.data.expiresAt) * 1000
          && await sessionVersionMatches(userId, Number(socket.data.sessionVersion));
        if (!valid) {
          socket.disconnect(true);
          next(new Error("Unauthorized"));
          return;
        }
        next();
      })().catch(() => {
        socket.disconnect(true);
        next(new Error("Unauthorized"));
      });
    });
    // Join personal + existing chat rooms. Connection failures must not become
    // unhandled promise rejections or leave a half-authenticated socket alive.
    void (async () => {
      try {
        socket.join(`user:${userId}`);
        const rooms = await RoomModel.find({ "members.user": userId }).select("_id").lean();
        await Promise.all(rooms.map((room) => socket.join(String(room._id))));
        await setStatus(userId, "online");
      } catch (error) {
        console.error("Socket connection setup failed:", error instanceof Error ? error.name : "unknown error");
        socket.disconnect(true);
      }
    })();

    socket.on("message:send", (payload: unknown) => {
      if (!allowUserEvent(userId, "message:send", 20, 60_000)) {
        socket.emit("app:error", rateLimitMessage);
        return;
      }
      const parsed = sendMessageEventSchema.safeParse(payload);
      if (!parsed.success) return;

      void (async () => {
        try {
          const { roomId, encryptedContent, encryptedIv, keyVersion, replyToId } = parsed.data;
          const room = await RoomModel.findOne({ _id: roomId, "members.user": userId }).select("currentKeyVersion members.user").lean();
          if (!room) return;
          if (room.currentKeyVersion !== keyVersion) {
            socket.emit("app:error", { error: "The room encryption key changed. Reload the room before sending." });
            return;
          }
          const message = await createEncryptedMessage({
            room: roomId, sender: userId, encryptedContent, encryptedIv, keyVersion, replyTo: replyToId ?? null,
          });
          await emitRoomEventToMembers(roomId, "message:new", message);
        } catch (error) {
          console.error("Socket message send failed:", error instanceof Error ? error.name : "unknown error");
          socket.emit("app:error", { error: "Unable to send message" });
        }
      })();
    });

    socket.on("room:read", (payload: unknown) => {
      if (!allowUserEvent(userId, "room:read", 90, 60_000)) return;
      const parsed = readMessageEventSchema.safeParse(payload);
      if (!parsed.success) return;

      void (async () => {
        try {
          const { roomId, messageId } = parsed.data;
          const [isMember, messageExists] = await Promise.all([
            RoomModel.exists({ _id: roomId, "members.user": userId }),
            MessageModel.exists({ _id: messageId, room: roomId }),
          ]);
          if (isMember && messageExists) await markRead(roomId, userId, messageId);
        } catch (error) {
          console.error("Socket read marker update failed:", error instanceof Error ? error.name : "unknown error");
        }
      })();
    });

    socket.on("typing", (payload: unknown) => {
      if (!allowUserEvent(userId, "typing", 20, 5_000)) return;
      const parsed = typingEventSchema.safeParse(payload);
      if (!parsed.success) return;
      const { roomId, isTyping } = parsed.data;
      void (async () => {
        const room = await RoomModel.findOne({ _id: roomId, "members.user": userId }).select("members.user").lean() as any;
        if (!room) return;
        const recipients = room.members.map((member: any) => String(member.user))
          .filter((memberId: string) => memberId !== userId)
          .map((memberId: string) => `user:${memberId}`);
        if (recipients.length) io.to(recipients).emit("typing", { roomId, userId, isTyping });
      })().catch(() => undefined);
    });

    socket.on("disconnect", () => {
      void (async () => {
        try {
          // A user can have multiple tabs/devices; one disconnect must not
          // mark them offline while another authenticated socket is still live.
          const remainingSockets = await io.in(`user:${userId}`).fetchSockets();
          if (remainingSockets.length === 0) await setStatus(userId, "offline");
        } catch (error) {
          console.error("Socket disconnect cleanup failed:", error instanceof Error ? error.name : "unknown error");
        }
      })();
    });
  });

  return io;
}
