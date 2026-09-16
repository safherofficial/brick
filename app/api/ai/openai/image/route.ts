import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPENAI_URL = "https://api.openai.com/v1/images/generations";
const MAX_PROMPT = 32000;

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return jsonError("OPENAI_API_KEY NOT CONFIGURED", 503);

  let body: { prompt?: unknown; size?: unknown; model?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError("INVALID JSON BODY");
  }

  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  if (!prompt) return jsonError("PROMPT REQUIRED");
  if (prompt.length > MAX_PROMPT) return jsonError("PROMPT TOO LONG");

  const size =
    body.size === "512x512" || body.size === "1024x1024" || body.size === "1792x1024" || body.size === "1024x1792"
      ? body.size
      : "1024x1024";

  const model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : "gpt-image-1";

  try {
    const upstream = await fetch(OPENAI_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        prompt,
        n: 1,
        size,
        response_format: "b64_json"
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(120_000)
    });

    const text = await upstream.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    if (!upstream.ok) {
      const message =
        payload && typeof payload === "object" && "error" in payload
          ? String((payload as { error?: { message?: string } }).error?.message ?? "OPENAI REQUEST FAILED")
          : `OPENAI REQUEST FAILED (${upstream.status})`;
      return jsonError(message, upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502);
    }

    const data = payload as { data?: { b64_json?: string }[] };
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) return jsonError("OPENAI RETURNED NO IMAGE");

    return NextResponse.json({
      b64,
      mime: "image/png",
      model,
      size
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OPENAI UPSTREAM ERROR";
    return jsonError(message, 502);
  }
}
