import type { ClassValue } from "clsx";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** "just now" / "5m ago" / "3h ago" / "2d ago". ISO string or unix ms in; "" when unknown. */
export function timeAgo(at: string | number | null | undefined): string {
  if (at == null || at === "") return "";
  const ms = Date.now() - (typeof at === "number" ? at : new Date(at).getTime());
  if (Number.isNaN(ms)) return "";
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  return hr < 24 ? `${hr}h ago` : `${Math.round(hr / 24)}d ago`;
}
