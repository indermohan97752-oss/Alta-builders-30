import { createServer } from "http";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { closeDb, connectDb } from "./db.js";
import { attachSocket } from "./socket.js";

const httpServer = createServer(createApp());
attachSocket(httpServer);

async function start() {
  await connectDb();
  httpServer.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port} (${config.env})`);
  });
}

async function shutdown() {
  httpServer.close();
  await closeDb();
  process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

start().catch((err) => {
  console.error("Failed to start. Check backend/.env and MongoDB connectivity:", err instanceof Error ? err.name : "unknown error");
  process.exit(1);
});
