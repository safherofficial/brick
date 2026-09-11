export const FREE_IMAGE_APPLIES = 5;
export const REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;
const KEY = "brick.entitlement.v1";

export type EntitlementState = {
  accountId: string;
  plan: "free" | "monthly";
  applies: { hash: string; at: number }[];
};

function empty(): EntitlementState {
  const accountId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `acc_${Date.now().toString(36)}`;
  return { accountId, plan: "free", applies: [] };
}

export function readEntitlement(): EntitlementState {
  if (typeof window === "undefined") return empty();
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) {
      const created = empty();
      window.localStorage.setItem(KEY, JSON.stringify(created));
      return created;
    }
    const parsed = JSON.parse(raw) as EntitlementState;
    if (!parsed.accountId || !Array.isArray(parsed.applies)) return empty();
    parsed.plan = parsed.plan === "monthly" ? "monthly" : "free";
    return parsed;
  } catch {
    return empty();
  }
}

function write(state: EntitlementState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(state));
}

export function remainingApplies(state = readEntitlement()) {
  if (state.plan === "monthly") return Number.POSITIVE_INFINITY;
  return Math.max(0, FREE_IMAGE_APPLIES - new Set(state.applies.map((i) => i.hash)).size);
}

export async function hashImageFile(file: File) {
  const buffer = await file.arrayBuffer();
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return `${file.name}:${file.size}:${file.lastModified}`;
}

export function consumeImageApply(hash: string) {
  const state = readEntitlement();
  const now = Date.now();
  if (state.plan === "monthly") {
    return {
      ok: true as const,
      reason: "subscribed" as const,
      remaining: Number.POSITIVE_INFINITY,
      message: "SUBSCRIBED"
    };
  }
  if (state.applies.some((i) => i.hash === hash && now - i.at < REPEAT_WINDOW_MS)) {
    return {
      ok: true as const,
      reason: "repeat" as const,
      remaining: remainingApplies(state),
      message: "SAME IMAGE"
    };
  }
  const left = remainingApplies(state);
  if (left <= 0) {
    return {
      ok: false as const,
      reason: "blocked" as const,
      remaining: 0,
      message: "SUBSCRIBE TO APPLY"
    };
  }
  state.applies.push({ hash, at: now });
  write(state);
  return {
    ok: true as const,
    reason: "quota" as const,
    remaining: left - 1,
    message: `${left - 1} LEFT`
  };
}

export function setLocalPlan(plan: "free" | "monthly") {
  const state = readEntitlement();
  state.plan = plan;
  write(state);
}
