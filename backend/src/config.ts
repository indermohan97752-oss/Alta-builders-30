import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required").refine(
    (value) => value.startsWith("mongodb://") || value.startsWith("mongodb+srv://"),
    "MONGODB_URI must use mongodb:// or mongodb+srv://",
  ),
  // Generate with: openssl rand -base64 48. No default or weak fallback is allowed.
  JWT_SECRET: z.string().min(64, "JWT_SECRET must be at least 64 characters; generate it with openssl rand -base64 48"),
  CLIENT_ORIGIN: z.string().url().default("http://localhost:5173"),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const env = parsed.data;
if (/^(.)\1+$/.test(env.JWT_SECRET) || /^(change-me|replace|secret|password|development|test)/i.test(env.JWT_SECRET)) {
  console.error("Refusing to start with a predictable JWT_SECRET. Generate one with: openssl rand -base64 48");
  process.exit(1);
}

if (env.NODE_ENV === "production") {
  if (env.BCRYPT_ROUNDS < 10) {
    console.error("Production requires BCRYPT_ROUNDS of at least 10");
    process.exit(1);
  }
  if (new URL(env.CLIENT_ORIGIN).protocol !== "https:") {
    console.error("Production requires an HTTPS CLIENT_ORIGIN");
    process.exit(1);
  }
  let mongoUrl: URL;
  try {
    mongoUrl = new URL(env.MONGODB_URI);
  } catch {
    console.error("MONGODB_URI is not a valid MongoDB URL");
    process.exit(1);
  }
  const usesTls = env.MONGODB_URI.startsWith("mongodb+srv://")
    ? mongoUrl.searchParams.get("tls") !== "false" && mongoUrl.searchParams.get("ssl") !== "false"
    : mongoUrl.searchParams.get("tls") === "true" || mongoUrl.searchParams.get("ssl") === "true";
  if (!usesTls || !mongoUrl.username || !mongoUrl.password) {
    console.error("Production requires MongoDB TLS and a dedicated database username/password (Atlas SRV URIs enable TLS by default)");
    process.exit(1);
  }
}

export const config = {
  env: env.NODE_ENV,
  port: env.PORT,
  mongoUri: env.MONGODB_URI,
  jwtSecret: env.JWT_SECRET,
  clientOrigin: env.CLIENT_ORIGIN,
  bcryptRounds: env.BCRYPT_ROUNDS,
  trustProxy: env.TRUST_PROXY,
};
