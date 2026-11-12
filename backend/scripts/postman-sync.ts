import "dotenv/config";
import { readFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const apiKey = process.env.POSTMAN_API_KEY;
if (!apiKey) {
  console.error("POSTMAN_API_KEY is not set. Add it to backend/.env");
  process.exit(1);
}
const workspace = process.env.POSTMAN_WORKSPACE_ID; // optional
const BASE = "https://api.getpostman.com";
const file = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../docs/postman/chat-app.postman_collection.json",
);

async function postman(pathname: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${pathname}`, {
    ...init,
    headers: { "X-Api-Key": apiKey!, "Content-Type": "application/json", ...(init.headers as Record<string, string>) },
  });
  const body: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Postman API ${res.status}: ${body?.error?.message ?? res.statusText}`);
  return body;
}

async function main() {
  const collection = JSON.parse(await readFile(file, "utf8"));
  const ws = workspace ? `?workspace=${encodeURIComponent(workspace)}` : "";

  const { collections } = await postman(`/collections${ws}`);
  const existing = collections.find((c: { name: string }) => c.name === collection.info.name);

  if (existing) {
    await postman(`/collections/${existing.uid}`, { method: "PUT", body: JSON.stringify({ collection }) });
    console.log(`Updated Postman collection "${collection.info.name}" (${existing.uid})`);
  } else {
    const created = await postman(`/collections${ws}`, { method: "POST", body: JSON.stringify({ collection }) });
    console.log(`Created Postman collection "${collection.info.name}" (${created.collection?.uid})`);
  }
}

main().catch((err) => {
  console.error(err.message); // never print the key
  process.exit(1);
});
