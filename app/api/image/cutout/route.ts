import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 30 * 1024 * 1024;
const SUPPORTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

function jsonError(message: string, status: number) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

async function providerRequest(
  provider: "photoroom" | "clipdrop",
  file: File
) {
  const bytes = await file.arrayBuffer();
  const body = new FormData();
  body.append(
    "image_file",
    new Blob([bytes], { type: file.type }),
    file.name || "input"
  );

  if (provider === "photoroom") {
    body.append("format", "png");
    return fetch("https://sdk.photoroom.com/v1/segment", {
      method: "POST",
      headers: {
        "x-api-key": process.env.PHOTOROOM_API_KEY!.trim()
      },
      body
    });
  }

  body.append("transparency_handling", "return_input_if_non_opaque");
  return fetch("https://clipdrop-api.co/remove-background/v1", {
    method: "POST",
    headers: {
      "x-api-key": process.env.CLIPDROP_API_KEY!.trim(),
      accept: "image/png"
    },
    body
  });
}

function providerOrder(): ("photoroom" | "clipdrop")[] {
  const configured = process.env.BRICK_IMAGE_API_PROVIDER?.trim().toLowerCase();
  const hasPhotoroom = Boolean(process.env.PHOTOROOM_API_KEY?.trim());
  const hasClipdrop = Boolean(process.env.CLIPDROP_API_KEY?.trim());

  if (configured === "photoroom") return hasPhotoroom ? ["photoroom"] : [];
  if (configured === "clipdrop") return hasClipdrop ? ["clipdrop"] : [];

  return [
    ...(hasPhotoroom ? ["photoroom" as const] : []),
    ...(hasClipdrop ? ["clipdrop" as const] : [])
  ];
}

export async function POST(request: Request) {
  try {
    const form = await request.formData();
    const file = form.get("image_file");
    if (!(file instanceof File)) {
      return jsonError("IMAGE_FILE_REQUIRED", 400);
    }
    if (!SUPPORTED_TYPES.has(file.type)) {
      return jsonError("UNSUPPORTED_IMAGE_TYPE", 415);
    }
    if (file.size < 1 || file.size > MAX_FILE_BYTES) {
      return jsonError("IMAGE_FILE_TOO_LARGE_OR_EMPTY", 413);
    }

    const providers = providerOrder();
    if (!providers.length) {
      return jsonError("REMOTE_IMAGE_AI_NOT_CONFIGURED", 503);
    }

    for (const provider of providers) {
      try {
        const response = await providerRequest(provider, file);
        if (!response.ok) continue;

        const output = await response.arrayBuffer();
        return new NextResponse(output, {
          status: 200,
          headers: {
            "content-type": "image/png",
            "cache-control": "no-store",
            "x-brick-image-provider": provider
          }
        });
      } catch {
        // Try the next configured provider, then fall back to the local pipeline.
      }
    }

    return jsonError("REMOTE_IMAGE_AI_FAILED", 502);
  } catch {
    return jsonError("REMOTE_IMAGE_AI_INVALID_REQUEST", 400);
  }
}
