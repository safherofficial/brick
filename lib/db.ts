import { neon } from "@neondatabase/serverless";

export function sql() {
  const url = process.env.POSTGRES_URL;
  if (!url) throw new Error("Missing POSTGRES_URL");
  return neon(url);
}
