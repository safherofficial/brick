import type { Voxel } from "@/lib/voxelEngine";

export type CreationSummary = {
  id: string;
  name: string;
  description: string | null;
  brick_count: number;
  likes_count: number;
  views_count: number;
  created_at: string;
  author: string | null;
  construction_data: { size: number; palette: string[]; voxels: Voxel[] };
};

export async function fetchCreations(sort: "latest" | "liked" = "latest") {
  const res = await fetch(`/api/creations?sort=${sort}`, { cache: "no-store" });
  const data = (await res.json()) as { ok: boolean; creations?: CreationSummary[] };
  return data.ok ? data.creations ?? [] : [];
}

export async function fetchCreation(id: string) {
  const res = await fetch(`/api/creations/${id}`, { cache: "no-store" });
  if (!res.ok) return null;
  const data = (await res.json()) as { ok: boolean; creation?: CreationSummary };
  return data.ok ? data.creation ?? null : null;
}

export async function publishCreation(payload: {
  wallet: string;
  title: string;
  description?: string;
  size: number;
  palette: string[];
  voxels: Voxel[];
}) {
  const res = await fetch("/api/creations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  const data = (await res.json()) as { ok: boolean; id?: string; error?: string };
  if (!data.ok) throw new Error(data.error ?? "PUBLISH_FAILED");
  return data.id as string;
}

export async function toggleLike(id: string, wallet: string) {
  const res = await fetch(`/api/creations/${id}/like`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet })
  });
  const data = (await res.json()) as { ok: boolean; liked?: boolean; likes_count?: number };
  if (!data.ok) throw new Error("LIKE_FAILED");
  return data;
}
