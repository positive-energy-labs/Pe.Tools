/**
 * Saved is an explicit source, not a fallback from a failed live read. The list and the one
 * capture are both the `takeoff-saved` Reading kind; nothing here calls the host directly.
 */
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  sameAddress,
  type Address,
  type TakeoffCapture,
  type takeoffCaptureSummarySchema,
} from "@pe/agent-contracts";
import type { z } from "zod";

import { SavedCaptureText } from "#/takeoff/saved-capture-text";
import { TakeoffsControllerOwner } from "#/takeoff/route";
import { RouteShell, useRoute } from "#/route";
import { Button } from "@pe/kit/lang/button";
import { List } from "@pe/kit/lang/list-popup";
import { listOf } from "@pe/kit/lang/collection";
import { previousOf } from "#/readings";
import { savedTakeoffsManifest as savedManifest } from "#/route/surface-manifests";
import type { TakeoffViewSelection } from "#/takeoff/route-workspace";

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
  const handle = useRoute(savedManifest, { target: null, url: false, page: { work: capture } });
  useEffect(() => {
    handle.page[1]({ work: capture });
  }, [capture]); // eslint-disable-line react-hooks/exhaustive-deps
  const one = handle.readings.capture as import("@pe/agent-contracts").Reading<TakeoffCapture>;
  const many = handle.readings.captures as import("@pe/agent-contracts").Reading<
    readonly z.infer<typeof takeoffCaptureSummarySchema>[]
  >;
  const saved = capture ? previousOf(one) : undefined;
  if (saved)
    return (
      <>
        {renderCapture(saved)}
        <SavedCaptureText id={saved.id} />
      </>
    );
  const reading = capture ? one : many;
  const source = listOf(many, (rows) =>
    rows.filter(
      (row) => document === undefined || (document !== null && sameAddress(row.document, document)),
    ),
  );
  return (
    <main className="min-h-screen px-6 py-4">
      <RouteShell
        manifest={savedManifest}
        handle={handle}
        head={
          <Button
            kind="framed"
            label="live"
            reason="Explicitly return to document selection in Revit"
            onClick={() => select({ work: undefined })}
          >
            live
          </Button>
        }
      />
      {capture && reading.state !== "failed" ? (
        <p>Reading saved capture…</p>
      ) : (
        // Pending, failed and empty are the list's own states (R7, R17), never a blank.
        <List
          aria-label="saved captures"
          {...source}
          keyOf={(row) => row.id}
          labelOf={(row) => row.title || row.id}
          empty="No saved captures. Read a selected document in live mode to capture geometry."
          onPick={(row) => select({ work: row.id })}
          row={(row) => ({
            label: row.title || row.id,
            meta: row.capturedAt,
            title: `Review ${row.document}; captured from ${row.provenance.target.session} / ${row.provenance.target.openId}`,
          })}
        />
      )}
    </main>
  );
}
