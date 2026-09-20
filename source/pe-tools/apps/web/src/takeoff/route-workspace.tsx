import { takeoffDiscardEdits } from "@pe/agent-contracts";
import { PartitionReview } from "#/takeoff/partition-review";
import { useNavigate } from "@tanstack/react-router";
import { FactChip } from "#/components/lang/chip";
import { ActionButton } from "#/components/lang/action-button";
import { Atlas } from "#/takeoff/atlas";
import { previousOf } from "#/readings";
import { type TakeoffsController } from "#/takeoff/controller";
import { RouteShell } from "#/route";
import { Situation, SituationCell, SituationChoice, useDocumentLadder } from "#/route/situation";
import { Picker } from "#/route/picker";
import { manifest } from "#/takeoff/manifest";
import { takeoffReadingHealth } from "#/takeoff/actions";
import { AdoptRegions, SyncPanel } from "#/takeoff/adopt-panel";

function TakeoffHead({ store }: { store: TakeoffsController }) {
  const ladder = useDocumentLadder(store.handle, store.actions.resetTarget);
  const staged = Object.keys(store.staged).length;
  const world = store.world;
  const capture = previousOf(store.snapshot);
  const health = takeoffReadingHealth(store.snapshot);
  const noun = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const toggle = (list: readonly string[], id: string) =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
  const read = capture ? undefined : "read the document first";
  const scope = (
    <SituationCell io="r" empty={!store.views.length}>
      <Picker
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
      <Picker
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
          <input
            aria-label="RHVAC file path"
            className="w-full border border-line bg-transparent p-2"
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
      band={store.stage === "adopt" ? <AdoptRegions store={store} /> : undefined}
      work={{
        count: staged,
        noun: "room edit",
        read: capture
          ? `${capture.reading.observedAt}${store.snapshot.state === "failed" ? " · stale" : ""}`
          : undefined,
        discard: () =>
          store.handle.work.doc
            ? store.handle.work.write(takeoffDiscardEdits(store.handle.work.doc))
            : Promise.resolve(null),
        body: staged ? (
          <span className="flex flex-wrap gap-x-4 text-ink-2">
            {Object.values(store.staged).map((edit) => (
              <span key={edit.roomId}>{edit.roomId}</span>
            ))}
          </span>
        ) : null,
      }}
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

export function TakeoffsView({
  store,
  select,
}: {
  store: TakeoffsController;
  select: (patch: TakeoffViewSelection) => void;
}) {
  const r10 = store.r10Path;
  const failure = store.failure;
  const panel = store.panel;
  const review = store.review;

  const savedHead = store.savedCapture ? (
    <div>
      <FactChip title="Explicit saved review; this capture does not assert current Revit geometry">
        saved review · {store.savedCapture.capturedAt}
      </FactChip>
      <span>
        {store.savedCapture.provenance.target.session} /{" "}
        {store.savedCapture.provenance.target.openId}
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
  ) : null;
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
  if (store.savedCapture)
    return <Atlas store={store} headRail={savedHead} readoutBand={readoutBand} />;
  return (
    <Atlas
      store={store}
      readoutBand={readoutBand}
      headRail={
        <RouteShell
          manifest={manifest}
          handle={store.handle}
          situation={<TakeoffHead store={store} />}
        />
      }
    />
  );
}
