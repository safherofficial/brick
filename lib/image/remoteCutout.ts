export type RemoteCutoutOutput = "2d" | "25d";

export async function requestRemoteCutout(
  file: File,
  output: RemoteCutoutOutput
): Promise<File | null> {
  if (typeof window === "undefined") return null;

  const form = new FormData();
  form.append("image_file", file, file.name);
  form.append("output", output);

  try {
    const response = await fetch("/api/image/cutout", {
      method: "POST",
      body: form,
      cache: "no-store"
    });
    if (!response.ok) return null;

    const blob = await response.blob();
    if (!blob.size || !blob.type.startsWith("image/")) return null;

    return new File(
      [blob],
      file.name.replace(/.[^.]+$/, "") + "-clean.png",
      { type: blob.type || "image/png" }
    );
  } catch {
    return null;
  }
}
