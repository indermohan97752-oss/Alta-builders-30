import { Router } from "express";
import { dbHealthy } from "../db.js";

export const healthRouter = Router();

// 200 when everything is up, 503 when a dependency is down
healthRouter.get("/", async (_req, res) => {
  const dbOk = await dbHealthy();
  res.status(dbOk ? 200 : 503).json({
    status: dbOk ? "ok" : "degraded",
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    checks: { database: dbOk ? "up" : "down" },
  });
});
