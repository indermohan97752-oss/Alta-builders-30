import "express-async-errors";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { config } from "./config.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { healthRouter } from "./routes/health.js";
import { invitationsRouter } from "./routes/invitations.js";
import { roomsRouter } from "./routes/rooms.js";
import { usersRouter } from "./routes/users.js";

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Too many login or signup attempts. Please try again later." },
});

export function createApp() {
  const app = express();
  app.disable("x-powered-by");

  // Render places one trusted reverse proxy in front of the service. Trust that
  // first hop in production so rate limiting sees each visitor's real client IP.
  // Local development remains untrusted unless explicitly configured.
  const trustProxy = config.env === "production" ? Math.max(config.trustProxy, 1) : config.trustProxy;
  if (trustProxy > 0) app.set("trust proxy", trustProxy);

  // The API does not serve HTML, so CSP is configured at the frontend/reverse proxy.
  app.use(helmet({ contentSecurityPolicy: false, strictTransportSecurity: config.env === "production" ? undefined : false }));
  app.use(cors({ origin: config.clientOrigin, credentials: true }));
  app.use(express.json({ limit: "64kb" }));

  // SameSite cookies plus an Origin allowlist protect cookie-authenticated writes from CSRF.
  app.use("/api", (req, res, next) => {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
      const origin = req.get("origin");
      if ((origin && origin !== config.clientOrigin) || (config.env === "production" && !origin)) {
        return res.status(403).json({ error: "Request origin is not allowed" });
      }
    }
    next();
  });

  app.use("/api", apiLimiter);
  app.use("/api/auth", authLimiter);
  app.use("/health", healthRouter);
  app.use("/api/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/admin", adminRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/rooms", roomsRouter);
  app.use("/api/invitations", invitationsRouter);

  app.use((err: Error & { status?: number; type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err.status && err.status >= 400 && err.status < 500) {
      return res.status(err.status).json({ error: err.status === 413 ? "Request body too large" : "Bad request" });
    }
    console.error("Unhandled API error:", err.name);
    return res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
