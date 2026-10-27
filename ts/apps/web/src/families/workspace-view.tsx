import { plural } from "#/components/work/band";
import { useState } from "react";
import { Surface } from "@pe/kit/lang/surface";
import { Switcher } from "@pe/kit/lang/switcher";
import { FamiliesMatrix } from "#/families/matrix";
import { familiesSpec } from "#/families/manifest";
import { FAMILIES_STAGES } from "#/families/stage";
import { DEMO_FAMILIES_SPEC } from "#/families/seeds";
import {
  FamiliesCarryOverLine,
  FamiliesProposalsBand,
  FamiliesReceipts,
  SalvagedExclusions,
} from "#/families/readout-bands";
import { LoadedFamilyPlacement } from "#/host/loaded-families-view";
import { FamiliesScopeProposal, filterWords } from "#/families/scope-band";
import { useFamiliesWorkspace } from "#/families/workspace-context";
import { EntityRouteView } from "#/route/entity";
import { Situation } from "#/route/situation";
import type { Rung } from "#/route/ladder";
import { Ladder } from "#/route/ladder";
import type { FamiliesObservationSummary } from "#/families/host";
import { inventoryOf, previousOf } from "#/readings";
import { Button } from "@pe/kit/lang/button";

const archiveDocument = (
  read: FamiliesObservationSummary,
  sessions: ReturnType<typeof inventoryOf>,
) =>
  read.documentTitle ||
  sessions
    .find((session) => session.sessionId === read.document.session)
    ?.openDocuments?.find((document) => document.openId === read.document.openId)?.title ||
  (read.work.binding === "address"
    ? read.work.target.split(/[\\/]/).at(-1) || read.work.target
    : read.document.openId);

function FamiliesHistoryView({ url }: { url?: boolean }) {
  const { store, lastReading } = useFamiliesWorkspace();
  const { list, selectedId, loading, error, failure, retry, select } = store.archive;
  const observed = previousOf(store.handle.inventory) as
    | { sessions?: Parameters<typeof inventoryOf>[0] }
    | undefined;
  const sessions = inventoryOf(observed?.sessions ?? []);
  const selected = list.find((read) => read.id === selectedId);
  const [palette, setPalette] = useState(false);
  return (
    <Surface
      head={
        <Situation
          handle={store.handle}
          inspection
          palette={url ? () => setPalette(true) : undefined}
          target={{ session: null, document: null }}
          chooseStage={(stage) => store.setPage({ stage: stage as "audit" | "apply" | "history" })}
          sentence={
            <>
              families from{" "}
              <Ladder
                open={palette}
                onOpenChange={setPalette}
                levels={[
                  {
                    key: "past read",
                    label: selected
                      ? `${archiveDocument(selected, sessions)} · ${new Date(selected.completedAt).toLocaleString()}${selected.readback ? " · after apply" : ""}`
                      : null,
                    placeholder: "choose a past read",
                    options: list.map((read) => ({
                      id: read.id,
                      label: archiveDocument(read, sessions),
                      sub: `${filterWords(read.filter)} · ${new Date(read.completedAt).toLocaleString()}${read.readback ? " · after apply" : ""}`,
                    })),
                    note: error ? failure : loading ? "loading past reads…" : "no past reads",
                    extra: error ? (
                      <Button
                        label="Retry"
                        reason={`Try loading the saved data again; does not read Revit · ${error}`}
                        kind="framed"
                        busy={loading}
                        onClick={retry}
                      >
                        Retry
                      </Button>
                    ) : undefined,
                    picked: (id) => id === selectedId,
                    pick: select,
                  },
                ]}
              />
              .
            </>
          }
          ledger={
            selected
              ? [
                  [
                    "reading",
                    `${archiveDocument(selected, sessions)} · ${new Date(selected.capturedAt).toLocaleString()}`,
                  ],
                ]
              : []
          }
        />
      }
    >
      <div className="flex size-full min-h-0 min-w-0 flex-col">
        {lastReading ? (
          <FamiliesMatrix />
        ) : (
          <p className="px-4 py-3 t-small text-ink-2">
            {error
              ? "Table unavailable. Retry or choose another past read above."
              : loading
                ? ""
                : "Choose a past read above. Reads saved in Audit appear here."}
          </p>
        )}
      </div>
    </Surface>
  );
}

/**
 * `/families` on the kernel. The sentence names the last completed read; the picker prepares the
 * next one. The matrix stays on its completed reading until Read families answers.
 */
export function FamiliesWorkspaceView({ url }: { url?: boolean }) {
  const { archived } = useFamiliesWorkspace();
  return archived ? <FamiliesHistoryView url={url} /> : <FamiliesActiveView url={url} />;
}

function FamiliesActiveView({ url }: { url?: boolean }) {
  const {
    store,
    applied,
    plan,
    includedPlanned,
    outsideProfile,
    matrixIssue,
    totalFamilies,
    draftCategories,
    pickedFamilies,
    categories,
    draftFamilyNames,
    categoryFeed,
    familyFeed,
    placement,
    setPlacement,
    setDraftCategories,
    setPickedFamilies,
    wire,
    overlay,
  } = useFamiliesWorkspace();
  const subOf = new Map(familyFeed.options?.map((option) => [option.id, option.sub]));
  const categoryCheck = (id: string): boolean | "mixed" => {
    if (!id) {
      if (!draftCategories.length) return false;
      if (draftCategories.length !== categories.length) return "mixed";
      const states = draftCategories.map(categoryCheck);
      return states.every((state) => state === true)
        ? true
        : states.every((state) => state === false)
          ? false
          : "mixed";
    }
    if (!draftCategories.includes(id)) return false;
    if (pickedFamilies === null) return true;
    const names =
      familyFeed.options
        ?.filter((option) => option.categoryName === id)
        .map((option) => option.id) ?? [];
    if (!names.length) return true;
    const selected = names.filter((name) => pickedFamilies.includes(name)).length;
    return selected === names.length ? true : selected > 0 ? "mixed" : false;
  };
  const targetRungs = (): readonly Rung[] => [
    {
      key: "category",
      label: draftCategories.length ? `${draftCategories.length} categories` : null,
      placeholder: "choose categories",
      options:
        categoryFeed.options === null
          ? null
          : [{ id: "", label: "all categories" }, ...categories.map((id) => ({ id, label: id }))],
      note: categoryFeed.state === "loading" ? "reading categories…" : "no categories",
      multi: true,
      picked: (id) =>
        id
          ? draftCategories.includes(id)
          : categories.length > 0 && draftCategories.length === categories.length,
      checked: categoryCheck,
      pick: (id) =>
        setDraftCategories(
          id === ""
            ? draftCategories.length === categories.length
              ? []
              : [...categories]
            : draftCategories.includes(id)
              ? draftCategories.filter((name) => name !== id)
              : [...draftCategories, id].sort(),
        ),
      extra: (
        <Switcher
          ariaLabel="placement filter"
          value={placement}
          onChange={setPlacement}
          options={[
            {
              value: LoadedFamilyPlacement.AllLoaded,
              label: "all loaded",
              title: "Read every loaded family in the selected categories",
            },
            {
              value: LoadedFamilyPlacement.PlacedOnly,
              label: "placed only",
              title: "Read families with placed instances",
            },
            {
              value: LoadedFamilyPlacement.UnplacedOnly,
              label: "unplaced only",
              title: "Read families without placed instances",
            },
          ]}
        />
      ),
    },
    {
      key: "family",
      label: draftCategories.length
        ? `${draftCategories.length === 1 ? draftCategories[0] : `${draftCategories.length} categories`} · ${
            pickedFamilies === null
              ? draftFamilyNames.length
                ? `all ${draftFamilyNames.length} families`
                : "all families"
              : `${pickedFamilies.length} families`
          }`
        : null,
      placeholder: "choose families",
      options:
        !draftCategories.length || familyFeed.options === null
          ? null
          : [
              { id: "", label: "all families" },
              // The feed's order: placed first, unplaced sunk; the sub says how many are placed.
              ...draftFamilyNames.map((id) => ({ id, label: id, sub: subOf.get(id) })),
            ],
      note: familyFeed.state === "loading" ? "resolving families…" : "no families",
      multi: true,
      picked: (id) => (id ? pickedFamilies?.includes(id) === true : pickedFamilies === null),
      checked: (id) =>
        id
          ? pickedFamilies === null || pickedFamilies.includes(id)
          : pickedFamilies === null
            ? true
            : pickedFamilies.length
              ? "mixed"
              : false,
      pick: (id) =>
        setPickedFamilies(
          id === ""
            ? pickedFamilies === null
              ? []
              : null
            : pickedFamilies === null
              ? draftFamilyNames.filter((name) => name !== id)
              : pickedFamilies.includes(id)
                ? pickedFamilies.filter((name) => name !== id)
                : [...pickedFamilies, id].sort(),
        ),
      extra: (
        <span className="t-small text-ink-2">
          {draftFamilyNames.length} families available · selections prepare the next read
        </span>
      ),
    },
  ];
  // An empty familyNames list means every family the categories resolve to: read the resolved count.
  const scoped = applied ? applied.familyNames.length || totalFamilies : 0;
  return (
    <EntityRouteView
      def={familiesSpec}
      handle={store.handle as never}
      refreshPods={store.refreshPods}
      fixture={store.demo ? DEMO_FAMILIES_SPEC : undefined}
      url={url}
      stages={FAMILIES_STAGES}
      // Grouped Work: apply stays a verb in the row and the lines get the log's room (ruling 39).
      commitIn="verbs"
      log="narrow"
      targetRungs={store.page.stage === "audit" ? targetRungs : undefined}
      subject={<>loaded families</>}
      health={matrixIssue?.title ?? null}
      wire={wire}
      output={store.applyData ? <FamiliesReceipts /> : null}
      // The Work sentence, then what the Work carries beside its cells.
      work={{
        // The patch's projected cells count in the sentence; accept and deny stay on its review row.
        counted: overlay.cells,
        draw: (_, sentence) => (
          <>
            {sentence}
            <FamiliesCarryOverLine />
            <FamiliesScopeProposal />
            <FamiliesProposalsBand />
          </>
        ),
      }}
      startFreshAside={<SalvagedExclusions />}
      onStartedFresh={store.actions.startedFresh}
      hold={(id) => {
        const row = store.plan?.entries.find((entry) => entry.id === id);
        if (row) void store.actions.exclude(row.name);
      }}
      facts={[
        [
          "scope",
          applied
            ? `${applied.placementScope} · ${applied.categoryNames.join(", ") || "every category"} · ${plural(scoped, "family")}`
            : "none read",
        ],
        [
          "plan",
          plan
            ? `${includedPlanned.length} / ${plan.entries.length} included · ${outsideProfile.length} unclaimed`
            : "none confirmed",
        ],
        ["applied", store.applyData ? store.applyData.appliedAt : "never"],
      ]}
    >
      <div className="flex size-full min-h-0 min-w-0 flex-col">
        <FamiliesMatrix />
      </div>
    </EntityRouteView>
  );
}
