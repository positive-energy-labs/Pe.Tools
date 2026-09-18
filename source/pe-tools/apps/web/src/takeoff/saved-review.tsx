/**
 * Saved is an explicit source, not a fallback from a failed live read. The list and the one
 * capture are both the `takeoff-saved` Reading kind; nothing here calls the host directly.
 */
import { useNavigate } from "@tanstack/react-router";
import {
  sameAddress,
  type Address,
  type TakeoffCapture,
  type takeoffCaptureSummarySchema,
} from "@pe/agent-contracts";
import type { z } from "zod";

import { SavedCaptureText } from "#/takeoff/saved-capture-text";
import { TakeoffsControllerOwner } from "#/takeoff/route";
import { RouteShell } from "#/route";
import { ActionButton } from "#/components/lang/action-button";
import { useReading, previousOf } from "#/readings";
import { emptyManifest } from "#/route";
import type { TakeoffViewSelection } from "#/takeoff/route-workspace";

const savedManifest = emptyManifest("takeoffs-saved", "Takeoffs saved review");

export function SavedTakeoffsRoute({ capture }: { capture?: string }) {
  const navigate = useNavigate({ from: "/takeoffs" });
  return (
    <SavedTakeoffsView
      capture={capture}
      select={(patch) => {
        void navigate({ search: (previous) => ({ ...previous, ...patch }) });
      }}
      renderCapture={(saved) => <TakeoffsControllerOwner key={saved.id} savedCapture={saved} />}
    />
  );
}

export function SavedTakeoffsView({
  capture,
  document,
  select,
  renderCapture,
}: {
  capture?: string;
  /** The thread head's document when hosted in Chat: only its captures are listed. Absent on the
   * route, which lists every capture; null while the thread names no resolved document. */
  document?: Address | null;
  select: (patch: TakeoffViewSelection) => void;
  renderCapture: (capture: TakeoffCapture) => import("react").ReactNode;
}) {
  const one = useReading<TakeoffCapture>(
    capture ? { kind: "takeoff-saved", id: capture } : { kind: "takeoff-saved" },
  );
  // ponytail: the host observer drops `document` from this Reading (resource-adapters.ts), so the
  // list is filtered here; forward it there and this filter becomes the host's.
  const many = useReading<readonly z.infer<typeof takeoffCaptureSummarySchema>[]>({
    kind: "takeoff-saved",
  });
  const saved = capture ? previousOf(one) : undefined;
  if (saved)
    return (
      <>
        {renderCapture(saved)}
        <SavedCaptureText id={saved.id} />
      </>
    );
  const reading = capture ? one : many;
  const rows = (capture ? [] : (previousOf(many) ?? [])).filter(
    (row) => document === undefined || (document !== null && sameAddress(row.document, document)),
  );
  return (
    <main className="min-h-screen px-6 py-4">
      <RouteShell manifest={savedManifest} />
      <ActionButton
        label="live"
        reason="Explicitly return to document selection in Revit"
        onClick={() => select({ work: undefined })}
      />
      {reading.state === "failed" ? (
        <p role="alert">{reading.message}</p>
      ) : capture ? (
        <p>Reading saved capture…</p>
      ) : reading.state !== "ready" ? (
        <p>Reading saved capture list…</p>
      ) : !rows.length ? (
        <p>No saved captures. Read a selected document in live mode to capture geometry.</p>
      ) : (
        <ul>
          {rows.map((row) => (
            <li key={row.id}>
              <ActionButton
                label={`${row.title || row.id} · ${row.capturedAt}`}
                reason={`Review ${row.document}; captured from ${row.provenance.target.session} / ${row.provenance.target.openId}`}
                onClick={() => select({ work: row.id })}
              />
            </li>
          ))}
        </ul>
      )}
      {capture && (
        <ActionButton
          label="choose capture"
          reason="Return to saved captures"
          onClick={() => select({ work: undefined })}
        />
      )}
    </main>
  );
}
