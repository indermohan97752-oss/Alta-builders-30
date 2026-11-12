import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { sessionVersionMatches } from "../models/user.js";

export interface AuthedRequest extends Request {
  userId?: string;
}

export const SESSION_COOKIE = config.env === "production" ? "__Host-chat_session" : "chat_session";
const SESSION_TTL_MS = 60 * 60 * 1000;
const JWT_ISSUER = "chat-app-api";
const JWT_AUDIENCE = "chat-app-client";

const cookieOptions = {
  httpOnly: true,
  secure: config.env === "production",
  sameSite: (config.env === "production" ? "none" : "lax") as "none" | "lax",
  path: "/",
  maxAge: SESSION_TTL_MS,
};

const signToken = (userId: string, sessionVersion: number) => jwt.sign(
  { sub: userId, ver: sessionVersion },
  config.jwtSecret,
  { algorithm: "HS256", expiresIn: "1h", issuer: JWT_ISSUER, audience: JWT_AUDIENCE },
);

export function setSessionCookie(res: Response, userId: string, sessionVersion: number) {
  res.cookie(SESSION_COOKIE, signToken(userId, sessionVersion), cookieOptions);
}

export function clearSessionCookie(res: Response) {
  const { maxAge: _maxAge, ...clearOptions } = cookieOptions;
  res.clearCookie(SESSION_COOKIE, clearOptions);
}

export function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function verifyToken(token: string): { userId: string; sessionVersion: number; expiresAt: number } | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret, {
      algorithms: ["HS256"],
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
    if (typeof payload === "string" || typeof payload.sub !== "string" || !Number.isInteger(payload.ver) || Number(payload.ver) < 0 || typeof payload.exp !== "number") return null;
    return { userId: payload.sub, sessionVersion: Number(payload.ver), expiresAt: payload.exp };
  } catch {
    return null;
  }
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = readCookie(req.headers.cookie, SESSION_COOKIE);
  const session = token ? verifyToken(token) : null;
  if (!session || !(await sessionVersionMatches(session.userId, session.sessionVersion))) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  req.userId = session.userId;
  next();
}
