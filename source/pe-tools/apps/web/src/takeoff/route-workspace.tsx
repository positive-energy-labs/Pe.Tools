import { ActionReceiptView } from "#/actions/receipt";
import { PartitionReview } from "#/takeoff/partition-review";
import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { FactChip } from "#/components/lang/chip";
import { OutcomeStrip } from "#/components/lang/outcome-strip";
import { ActivityDisclosure, ActivityRow } from "#/components/lang/activity";
import { ActionButton } from "#/components/lang/action-button";
import { Atlas } from "#/takeoff/atlas";
import { previousOf } from "#/readings";
import { type TakeoffStore } from "#/takeoff/store";
import { RouteShell } from "#/route";
import { manifest } from "#/takeoff/manifest";
import { SyncPanel } from "#/takeoff/adopt-panel";

export function TakeoffsPage({ store }: { store: TakeoffStore }) {
  const navigate = useNavigate({ from: "/takeoffs" });
  return (
    <TakeoffsView
      store={store}
      select={(patch) => {
        void navigate({ search: (previous) => ({ ...previous, ...patch }) });
      }}
    />
  );
}

/** What the route can put in its own URL. `?source=` is gone; `?demo=` and `?work=` replace it. */
export type TakeoffViewSelection = {
  demo?: string;
  work?: string;
  doc?: import("@pe/agent-contracts").Address;
  target?: string;
};

export function TakeoffsView({
  store,
  select,
}: {
  store: TakeoffStore;
  select: (patch: TakeoffViewSelection) => void;
}) {
  const operations = store.operations;
  const [receiptId, setReceiptId] = useState<string>();
  // Missing, loading, failed-with-previous and successful-empty are four different answers.
  // Collapsing them to [] would let a failed status read read as "no activity".
  const receipts = previousOf(operations) ?? [];
  const unresolved = receipts.filter((row) => row.state !== "succeeded" && row.state !== "failed");
  const unresolvedIds = new Set(unresolved.map((row) => row.id));
  const activity =
    operations.state === "failed"
      ? {
          tone: "caution" as const,
          summary: receipts.length
            ? `could not read activity — showing ${receipts.length} from the last observation`
            : "could not read activity — status unknown",
          says: `Could not determine current status: ${operations.message}. This is a read failure, not a failed operation.`,
        }
      : operations.state === "absent"
        ? {
            tone: "meta" as const,
            summary: "activity not read yet",
            says: undefined,
          }
        : {
            tone: unresolved.length ? ("caution" as const) : ("meta" as const),
            summary: unresolved.length
              ? `${unresolved.length} outcome${unresolved.length === 1 ? "" : "s"} unresolved`
              : receipts.length
                ? `no unresolved work · ${receipts.length} recorded`
                : "no activity yet",
            says: undefined,
          };
  const r10 = store.r10Path;
  const geometry = store.snapshot;
  const captured = geometry ? previousOf(geometry) : undefined;
  const readingGeometry =
    store.handle.resolution.kind === "resolved" &&
    store.handle.resolution.target.kind === "document" &&
    store.geometryObservation?.kind === "reading";
  const failure = store.failure;
  const panel = store.panel;
  const review = store.review;

  const headRail = store.savedCapture ? (
    <div>
      <FactChip title="Explicit saved review; this capture does not assert current Revit geometry">
        saved review · {store.savedCapture.capturedAt}
      </FactChip>
      <span>
        {store.savedCapture.provenance.kind === "legacy-unknown"
          ? "original target unknown"
          : `${store.savedCapture.provenance.target.session} / ${store.savedCapture.provenance.target.openId}`}
      </span>
      {r10 && <span>file: {r10}</span>}
      {failure && <span role="alert">{failure.message}</span>}
      <ActionButton
        label="choose capture"
        reason="Choose another dated capture"
        onClick={() => select({ work: undefined })}
      />
      <ActionButton
        label="live"
        reason="Explicitly return to the selected Revit document"
        onClick={() => select({ work: undefined, demo: undefined })}
      />
    </div>
  ) : (
    <div>
      <RouteShell
        manifest={manifest}
        handle={store.handle}
        aside={
          captured ? (
            <FactChip title="Time of the last captured geometry; refresh failures remain visible in the geometry readout">
              capture · {captured.reading.observedAt}
              {geometry?.state === "failed"
                ? " · stale"
                : geometry?.state === "loading" || readingGeometry
                  ? " · refreshing"
                  : ""}
            </FactChip>
          ) : readingGeometry ? (
            <FactChip title="The selected document is being captured">reading geometry</FactChip>
          ) : geometry?.state === "failed" ? (
            <span role="alert">{geometry.message}</span>
          ) : undefined
        }
      >
        <span className="flex min-w-0 flex-col gap-1">
          <span className="flex min-w-0 items-center gap-2">
            <OutcomeStrip
              busy={store.busy ? `${store.busy.key} · ${store.busy.seconds}s` : null}
              failure={store.failure}
            />
            <ActionButton
              label="saved review"
              reason="Choose a dated host capture without Revit"
              onClick={() => select({ work: "latest" })}
            />
            {failure ? (
              <ActionButton
                label="dismiss"
                onClick={() => store.actions.clearFailure()}
                reason="Clears this error line. It does not retry — re-run the action that failed."
              />
            ) : null}
          </span>
          <ActivityDisclosure summary={activity.summary} tone={activity.tone}>
            {activity.says || receipts.length ? (
              <>
                {activity.says ? (
                  <ActivityRow label="activity read" says={activity.says} tone="caution" />
                ) : null}
                {/* Every unresolved row stays listed. A newer success, or an unrelated read
                    completing, never removes one. */}
                {[...unresolved, ...receipts.filter((row) => !unresolvedIds.has(row.id))].map(
                  (row) => (
                    <ActivityRow
                      key={row.id}
                      label={`${row.key} / ${row.state}`}
                      says={`action ${row.id} · started ${row.startedAt} (observed at, not proof of freshness)`}
                      tone={
                        row.state === "succeeded" || row.state === "failed" ? "meta" : "caution"
                      }
                    >
                      <ActionButton
                        label={receiptId === row.id ? "hide receipt" : "read status"}
                        reason={`Read original action ${row.id} through this route's own owner. Opening adds no background stream.`}
                        onClick={() => setReceiptId(receiptId === row.id ? undefined : row.id)}
                      />
                    </ActivityRow>
                  ),
                )}
                {receiptId ? <ActionReceiptView id={receiptId} /> : null}
              </>
            ) : null}
          </ActivityDisclosure>
        </span>
      </RouteShell>
    </div>
  );
  // Null, not an empty fragment: the band's container pays inset for whatever it holds, so an
  // absent panel must be absent, not an empty strip (annotation, 2026-08-31).
  const readoutBand =
    panel === "sync" ? (
      <SyncPanel store={store} />
    ) : review ? (
      <PartitionReview
        key={review.data?.source.runId ?? review.zone}
        review={review}
        onFlag={!store.readOnly ? (key) => store.actions.flagReview(key) : undefined}
      />
    ) : null;
  return (
    <Atlas
      store={store}
      // The receipt strip and its detail live in the head's activity disclosure, which reads
      // through this route's own owner. A second mount here would re-read the same action on
      // the default owner.
      headRail={headRail}
      readoutBand={readoutBand}
    />
  );
}
