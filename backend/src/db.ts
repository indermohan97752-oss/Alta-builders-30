import mongoose from "mongoose";
import { config } from "./config.js";

mongoose.set("strictQuery", true);

/** Connect to MongoDB, retrying while it boots (e.g. right after `docker compose up`). */
export async function connectDb(uri = config.mongoUri, retries = 10, delayMs = 1500): Promise<void> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 20, minPoolSize: 0 });
      console.log("Connected to MongoDB");
      return;
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`Database not ready (attempt ${attempt}/${retries}), retrying...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

export async function dbHealthy(): Promise<boolean> {
  try {
    if (mongoose.connection.readyState !== 1) return false;
    await mongoose.connection.db?.admin().ping();
    return true;
  } catch {
    return false;
  }
}

export const closeDb = () => mongoose.disconnect();
