/**
 * The machine's mutations other than update (`install.ts`): the share switch, and the tray's two
 * host verbs. Each is a plain call; the Machine reading is the only state, so success dirties it.
 */
import { dirty } from "#/readings";

/** `PUT /pe/share`. A 409 is the host's refusal, drawn from the reading it updates. */
export async function switchShare(on: boolean): Promise<void> {
  const response = await fetch("/pe/share", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ on }),
  });
  if (!response.ok && response.status !== 409) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw Error(body?.error ?? `share switch refused (${response.status})`);
  }
  dirty({ kind: "machine" });
}

/** The tray's Open window and Quit host. Only the tray carries the service token they need. */
export async function hostAdmin(verb: "window" | "shutdown"): Promise<string> {
  const response = await fetch(`/admin/${verb}`, { method: "POST" });
  if (!response.ok) throw Error(`/admin/${verb} refused (${response.status})`);
  return verb === "window" ? "window opened" : "host is shutting down";
}
