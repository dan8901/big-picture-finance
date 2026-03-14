import { createHmac } from "crypto";

export function getAuthSecret(): string | undefined {
  if (process.env.AUTH_SECRET) return process.env.AUTH_SECRET;
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return undefined;
  return createHmac("sha256", dbUrl).update("auth-secret").digest("hex");
}

export function getCronSecret(): string | undefined {
  if (process.env.CRON_SECRET) return process.env.CRON_SECRET;
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return undefined;
  return createHmac("sha256", dbUrl).update("cron-secret").digest("hex");
}
