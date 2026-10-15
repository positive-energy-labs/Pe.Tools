import { createHash } from "node:crypto";
import type { Machine, HoldingsReading, HoldingsReadingResult } from "@pe/agent-contracts";

/** Pages the one SDK-probed Machine observation; no second cache or writable state. */
export function readHoldings(machine: Machine, request: HoldingsReading): HoldingsReadingResult {
  const refuse = (code: string, detail: string) => ({ state: "refused" as const, code, detail });
  if (machine.legs.sessions?.error || !machine.legs.sessions?.observedAtUtc)
    return refuse("holdings.sessions-unavailable", "Session census is unread or failed.");
  const matches = (machine.revit.sessions ?? []).filter(({ row }) =>
    "id" in request.session
      ? "id" in row && row.id === request.session.id
      : "process" in row && row.process?.pid === request.session.pid,
  );
  if (matches.length !== 1)
    return refuse("holdings.session-missing", "The exact session is not available.");
  const session = matches[0]!;
  const row = session.row;
  if (
    !("process" in row) ||
    !row.process ||
    row.process.processStartUtc !== request.processStartUtc
  )
    return refuse("holdings.incarnation-mismatch", "The process incarnation changed.");
  if (row.execution?.allowed !== true)
    return refuse(
      "holdings.foreign-runtime",
      row.execution?.detail ?? "Runtime ownership is not verified.",
    );
  if (
    !session.documentsLeg.observedAtUtc ||
    session.documentsLeg.error ||
    session.documents === null
  )
    return refuse(
      "holdings.documents-unavailable",
      "Open-document observation is unread or failed.",
    );
  if (!session.documents.some((doc) => doc.openId === request.openId))
    return refuse("holdings.document-missing", "The exact SDK document lifetime is not open.");
  if (!session.holdingsLeg.observedAtUtc || session.holdingsLeg.error || session.holdings === null)
    return refuse(
      "holdings.unavailable",
      session.holdingsLeg.error ?? "Holdings have not been observed.",
    );
  const document = session.holdings.find((doc) => doc.openId === request.openId);
  if (!document)
    return refuse(
      "holdings.document-unobserved",
      "The holdings observation does not name this document.",
    );
  const { elements, worksets, ...facts } = document.holdings;
  const ordered = [...elements]
    .map((element) => ({ ...element, requesters: [...element.requesters].sort() }))
    .sort((a, b) => a.id - b.id);
  const sortedWorksets = [...worksets].sort();
  const selected = request.section === "worksets" ? sortedWorksets : ordered;
  const digest = createHash("sha256")
    .update(
      JSON.stringify({
        process: row.process,
        openId: request.openId,
        facts,
        elements: ordered,
        worksets: sortedWorksets,
        section: request.section,
      }),
    )
    .digest("hex");
  let offset = 0;
  if (request.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(request.cursor, "base64url").toString("utf8")) as {
        digest: string;
        offset: number;
      };
      if (cursor.digest !== digest)
        return refuse(
          "holdings.stale-cursor",
          "Holdings content or target changed; begin a new read.",
        );
      if (!Number.isInteger(cursor.offset) || cursor.offset < 0 || cursor.offset > selected.length)
        return refuse("holdings.invalid-cursor", "Cursor offset is invalid.");
      offset = cursor.offset;
    } catch {
      return refuse("holdings.invalid-cursor", "Cursor is invalid.");
    }
  }
  const rows = selected.slice(offset, offset + request.limit);
  if (Buffer.byteLength(JSON.stringify(rows), "utf8") > 65536)
    return refuse("holdings.page-too-large", "This page exceeds 64 KiB; request a smaller limit.");
  const next = offset + rows.length;
  return {
    state: "ok" as const,
    process: row.process,
    session: request.session,
    openId: request.openId,
    title: document.title,
    observedAtUtc: session.holdingsLeg.observedAtUtc,
    leg: session.holdingsLeg,
    source: "SDK doc list --holdings via canonical Machine",
    digest,
    ...facts,
    section: request.section,
    total: selected.length,
    elementCount: ordered.length,
    worksetCount: worksets.length,
    offset,
    rows,
    nextCursor:
      next < selected.length
        ? Buffer.from(JSON.stringify({ digest, offset: next })).toString("base64url")
        : null,
  };
}
