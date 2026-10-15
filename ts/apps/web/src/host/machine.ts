import { peClient } from "./pe-client";
import { hostFetch } from "#/host/runtime";
/**
 * The machine's mutations other than update (`install.ts`): the share switch, and the tray's two
 * host verbs. Each is a plain call; the Machine reading is the only state, so success dirties it.
 */
import { dirty } from "#/readings";
import type { ActionReceipt } from "@pe/agent-contracts";

export async function alignRevitBootstrap(
  year: string,
  confirmedVersion: string,
): Promise<ActionReceipt> {
  const response = await peClient.response("machine.bootstrap", {
    body: { id: crypto.randomUUID(), year, confirmedVersion },
  });
  if (!response.ok)
    throw Error((await response.text()) || `Alignment refused (${response.status}).`);
  const receipt = (await response.json()) as ActionReceipt;
  dirty({ kind: "machine" });
  return receipt;
}

/** `PUT /pe/share`. A 409 is the host's refusal, drawn from the reading it updates. */
export async function switchShare(on: boolean): Promise<void> {
  return setShare({ on });
}

export async function switchRemoteAdministration(
  allowRemoteAdministration: boolean,
): Promise<void> {
  return setShare({ allowRemoteAdministration });
}

async function setShare(
  body: { on: boolean } | { allowRemoteAdministration: boolean },
): Promise<void> {
  const response = await peClient.response("share.set", { body });
  if (!response.ok && response.status !== 409) {
    const body = (await response.json().catch(() => null)) as {
      error?: { message: string };
    } | null;
    throw Error(body?.error?.message ?? `share switch refused (${response.status})`);
  }
  dirty({ kind: "machine" });
}

/** The tray's Open window and Quit host. Only the tray carries the service token they need. */
export async function hostAdmin(verb: "window" | "shutdown"): Promise<string> {
  const response = await hostFetch(`/admin/${verb}`, { method: "POST" });
  if (!response.ok) throw Error(`/admin/${verb} refused (${response.status})`);
  return verb === "window" ? "window opened" : "host is shutting down";
}
