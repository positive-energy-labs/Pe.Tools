import { PartitionReview } from "#/takeoff/partition-review";
import { flagShape, flagZone, TakeoffProposalRows } from "#/takeoff/proposals";
import { useNavigate } from "@tanstack/react-router";
import type { TakeoffCapture, takeoffCaptureSummarySchema } from "@pe/agent-contracts";
import type { z } from "zod";
import { Atlas } from "#/takeoff/atlas";
import { previousOf, useReading } from "#/readings";
import { type TakeoffsController } from "#/takeoff/controller";
import { RouteShell } from "#/route";
import { Situation } from "#/route/situation";
import { useDocumentLadder } from "#/route/situation-ladder";
import { SituationCell, SituationChoice } from "#/route/situation-marks";
import { Ladder } from "#/route/ladder";
import { manifest } from "#/takeoff/manifest";
import { takeoffReadingHealth } from "#/takeoff/actions";
import { AdoptRegions, SyncPanel } from "#/takeoff/adopt-panel";
import { Input } from "#/components/lang/input";

function TakeoffHead({ store }: { store: TakeoffsController }) {
  const ladder = useDocumentLadder(store.handle, store.actions.resetTarget);
  const world = store.world;
  const capture = previousOf(store.snapshot);
  const health = takeoffReadingHealth(store.snapshot);
  const noun = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const toggle = (list: readonly string[], id: string) =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
  const read = capture ? undefined : "read the document first";
  const scope = (
    <SituationCell io="r" empty={!store.views.length}>
      <Ladder
        levels={[
          ...ladder.levels,
          {
            key: "views",
            label: store.views.length
              ? `${ladder.docWord ?? "document"} › ${noun(store.views.length, "view")}`
              : null,
            placeholder: `${ladder.docWord ?? "document"} › choose views`,
            options: capture
              ? world.lanes.map((lane) => ({ id: lane.view, label: lane.view }))
              : null,
            note: read,
            multi: true,
            picked: (id) => store.views.includes(id),
            pick: (id) => store.actions.chooseViews(toggle(store.views, id)),
          },
        ]}
      />
    </SituationCell>
  );
  const zones = (
    <SituationCell io={store.stage === "sync" ? "r" : "rw"} empty={!store.zones.length}>
      <Ladder
        levels={[
          {
            key: "zones",
            label: store.zones.length ? noun(store.zones.length, "zone") : null,
            placeholder: "choose zones",
            options: capture
              ? world.zones
                  .filter((zone) => store.views.includes(zone.zone.lane.view))
                  .map((zone) => ({
                    id: zone.zone.guid,
                    label: zone.name,
                    sub: noun(zone.rooms.length, "room"),
                  }))
              : null,
            note: read,
            multi: true,
            picked: (id) => store.zones.includes(id),
            pick: (id) => store.actions.chooseZones(toggle(store.zones, id)),
          },
        ]}
      />
    </SituationCell>
  );
  const file = (
    <SituationCell io="w" empty={!store.r10Path}>
      <SituationChoice
        empty={!store.r10Path}
        label={store.r10Path.split(/[/]/).at(-1) || "choose an .r10 file"}
      >
        <label className="grid gap-2">
          RHVAC file path
          <Input
            aria-label="RHVAC file path"
            value={store.r10Path}
            onChange={(event) => store.actions.chooseR10(event.target.value)}
            placeholder="Full path to an .r10 file"
          />
        </label>
      </SituationChoice>
    </SituationCell>
  );
  const sentence =
    store.stage === "adopt" ? (
      <>from {scope}.</>
    ) : store.stage === "audit" ? (
      <>
        in {scope} across {zones}.
      </>
    ) : (
      <>
        from {scope} across {zones} into {file}.
      </>
    );
  return (
    <Situation
      handle={store.handle}
      target={{ session: ladder.sessionWord, document: ladder.docWord }}
      health={health}
      sentence={sentence}
      chooseStage={(stage) => store.actions.chooseStage(stage as typeof store.stage)}
      commit="commit-sync"
      work={(_, sentence) => (
        <>
          {sentence}
          {store.stage === "adopt" ? <AdoptRegions store={store} /> : null}
        </>
      )}
      // A staged room edit carries its room's base; the controller's wire writes it.
      wire={store.wires.edits}
      ledger={[
        [
          "read",
          capture
            ? `${capture.reading.observedAt}${store.snapshot.state === "failed" ? " · stale" : ""}`
            : store.snapshot.state,
        ],
        ["file", store.r10Path || "none"],
      ]}
    />
  );
}

/**
 * A saved capture is Archived: inspection only, no verbs, no Work. The sentence names the capture;
 * when and where it was taken is hover and ledger (density law). Choosing a stage returns live.
 */
function SavedTakeoffHead({
  store,
  capture,
  select,
}: {
  store: TakeoffsController;
  capture: TakeoffCapture;
  select: (patch: TakeoffViewSelection) => void;
}) {
  const many = useReading<readonly z.infer<typeof takeoffCaptureSummarySchema>[]>({
    kind: "takeoff-saved",
  });
  const rows = previousOf(many) ?? [];
  const from = `${capture.provenance.target.session} / ${capture.provenance.target.openId}`;
  const title =
    rows.find((row) => row.id === capture.id)?.title || capture.provenance.target.openId;
  return (
    <Situation
      handle={store.handle}
      inspection
      target={{ session: null, document: null }}
      chooseStage={() => select({ work: undefined, demo: undefined })}
      sentence={
        <>
          takeoff from{" "}
          <Ladder
            title={`captured ${capture.capturedAt} from ${from}; does not assert current Revit geometry`}
            levels={[
              {
                key: "saved capture",
                label: title,
                placeholder: "choose a saved capture",
                options: rows.map((row) => ({
                  id: row.id,
                  label: row.title || row.id,
                  sub: row.capturedAt,
                })),
                note: many.state === "failed" ? many.message : "no saved captures",
                picked: (id) => id === capture.id,
                pick: (id) => select({ work: id }),
              },
            ]}
          />
          .
        </>
      }
      ledger={[
        ["captured", capture.capturedAt],
        ["from", from],
        ["file", store.r10Path || "none"],
      ]}
    />
  );
}

export function TakeoffsPage({ store }: { store: TakeoffsController }) {
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

function TakeoffsView({
  store,
  select,
}: {
  store: TakeoffsController;
  select: (patch: TakeoffViewSelection) => void;
}) {
  const panel = store.panel;
  const review = store.review;

  // Null, not an empty fragment: the band's container pays inset for whatever it holds, so an
  // absent panel must be absent, not an empty strip (annotation, 2026-08-31).
  const readoutBand =
    panel === "sync" ? (
      <SyncPanel store={store} />
    ) : review ? (
      <>
        <PartitionReview
          key={review.data?.source.runId ?? review.zone}
          review={review}
          onFlag={!store.readOnly ? (key) => store.actions.flagReview(key) : undefined}
        />
        {/* Pea's proposed review flags on this zone's shapes, in the band grammar. */}
        <TakeoffProposalRows
          cells={store.cells.reviewFlags}
          wire={store.wires.reviewFlags}
          keep={(key) => flagZone(key) === review.zone}
          label={(key) => `flag shape ${flagShape(key)}`}
          show={() => "flagged for review"}
        />
      </>
    ) : null;
  return (
    <Atlas
      store={store}
      readoutBand={readoutBand}
      headRail={
        <RouteShell
          manifest={manifest}
          handle={store.handle}
          situation={
            store.savedCapture ? (
              <SavedTakeoffHead store={store} capture={store.savedCapture} select={select} />
            ) : (
              <TakeoffHead store={store} />
            )
          }
        />
      }
    />
  );
}
