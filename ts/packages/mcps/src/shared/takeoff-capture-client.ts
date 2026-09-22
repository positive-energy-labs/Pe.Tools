import {
  takeoffCaptureSchema,
  type TakeoffCapture,
  type TakeoffObservation,
  takeoffObservationStatusSchema,
  type DocumentRef,
} from "@pe/agent-contracts";
import {
  HOST_RPC_BRIDGE_SESSION_HEADER,
  HOST_RPC_DOCUMENT_HEADER,
} from "@pe/host-contracts/operation-types";

/** Both browser and MCP collect through the actual /call publication boundary. */
export async function readTakeoffCapture(target: DocumentRef, base = "", signal?: AbortSignal) {
  signal = signal
    ? AbortSignal.any([signal, AbortSignal.timeout(120_000)])
    : AbortSignal.timeout(120_000);
  const response = await fetch(`${base}/call`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [HOST_RPC_BRIDGE_SESSION_HEADER]: target.session,
      [HOST_RPC_DOCUMENT_HEADER]: target.openId,
    },
    body: JSON.stringify({ key: "takeoffs.snapshot" }),
    signal,
  });
  if (!response.ok)
    throw Error(`Snapshot read failed (${response.status}): ${await response.text()}`);
  const id = response.headers.get("x-pe-takeoff-capture-id");
  if (!id) throw Error("Snapshot response omitted its durable capture identity.");
  const capture = await readSavedTakeoffCapture(id, base, signal);
  if (
    capture.provenance.kind !== "live" ||
    capture.provenance.target.session !== target.session ||
    capture.provenance.target.openId !== target.openId
  )
    throw Error("Snapshot capture does not belong to the requested open document lifetime.");
  return capture;
}

// Immutable IDs share one bounded cache across observation/status and explicit saved reads.
const captures = new Map<string, Promise<TakeoffCapture>>();
/** That capture file's exact stored text and path, by its already-validated ID. Read once. */
export async function readSavedTakeoffText(
  id: string,
  base = "",
  signal?: AbortSignal,
): Promise<{ path: string; text: string }> {
  const response = await fetch(
    `${base}/takeoffs/observations?capture=${encodeURIComponent(id)}&text=1`,
    { signal: signal ?? AbortSignal.timeout(30_000) },
  );
  if (!response.ok) throw Error(`Saved capture text read failed (${response.status})`);
  return (await response.json()) as { path: string; text: string };
}

export async function readSavedTakeoffCapture(id: string, base = "", signal?: AbortSignal) {
  const key = `${base}/${id}`;
  let pending = captures.get(key);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(
        `${base}/takeoffs/observations?capture=${encodeURIComponent(id)}`,
        {
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!response.ok) throw Error(`Saved capture read failed (${response.status})`);
      const capture = takeoffCaptureSchema.parse(await response.json());
      if (capture.id !== id)
        throw Error("Saved capture identity differs from the requested capture");
      return capture;
    })();
    captures.set(key, pending);
    void pending.catch(() => captures.delete(key));
    if (captures.size > 32) captures.delete(captures.keys().next().value!);
  }
  const capture = await pending;
  signal?.throwIfAborted();
  return capture;
}

export async function readTakeoffObservation(
  target: DocumentRef,
  base = "",
  signal?: AbortSignal,
): Promise<TakeoffObservation> {
  const response = await fetch(`${base}/takeoffs/observations`, {
    headers: {
      [HOST_RPC_BRIDGE_SESSION_HEADER]: target.session,
      [HOST_RPC_DOCUMENT_HEADER]: target.openId,
    },
    signal,
  });
  if (!response.ok) throw Error(`Observation read failed (${response.status})`);
  const status = takeoffObservationStatusSchema.parse(await response.json());
  if (status.target.session !== target.session || status.target.openId !== target.openId)
    throw Error("Observation target changed");
  if (status.kind === "empty") return status;
  const id = status.kind === "ready" ? status.captureId : status.previousId;
  const capture = id ? await readSavedTakeoffCapture(id, base, signal) : undefined;
  if (
    capture &&
    (capture.provenance.kind !== "live" ||
      capture.provenance.target.session !== target.session ||
      capture.provenance.target.openId !== target.openId)
  )
    throw Error("Capture target changed");
  if (status.kind === "ready")
    return {
      kind: "ready",
      target,
      capture: capture as Extract<TakeoffObservation, { kind: "ready" }>["capture"],
    };
  return {
    kind: status.kind,
    target,
    ...(status.kind === "failed" ? { error: status.error } : {}),
    ...(capture ? { previous: capture } : {}),
  } as TakeoffObservation;
}
