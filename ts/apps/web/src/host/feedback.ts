import { peUrl, resolveWorkbenchConfig } from "#/workbench/config";

export type Feedback = {
  comment: string;
  url: string;
  selector: string | null;
  component: string | null;
  components: string[];
  html: string;
  rect: { x: number; y: number; width: number; height: number };
  viewport: { width: number; height: number; dpr: number };
  picture: string | null;
  picture_error: string | null;
};

/** Resolves once the host has handed the note to PostHog; throws the host's reason otherwise. */
export async function sendFeedback(feedback: Feedback): Promise<void> {
  const response = await fetch(peUrl(resolveWorkbenchConfig(), "/feedback"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(feedback),
  });
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  throw new Error(body?.error ?? `feedback failed (${response.status})`);
}
