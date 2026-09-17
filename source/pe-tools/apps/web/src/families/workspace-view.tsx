import { Pane } from "#/components/lang/pane";
import { Surface } from "#/components/lang/surface";
import { FamiliesMatrix } from "#/families/matrix";
import { manifest } from "#/families/manifest";
import { FamiliesReadoutBands } from "#/families/readout-bands";
import { FamiliesFilterBand } from "#/families/scope-band";
import { RouteShell } from "#/route";
import { Picker } from "#/route/picker";
import { Situation, SituationCell, useDocumentLadder } from "#/route/situation";
import { useFamiliesWorkspace } from "#/families/workspace-context";

const noun = (n: number, word: string) =>
  `${n} ${n === 1 ? word : word.endsWith("y") ? `${word.slice(0, -1)}ies` : `${word}s`}`;

/**
 * The Families Situation. Stage word first (Scoping / Reviewing), then the profile slot (a picker
 * over the profile library) and the applied scope's terminal ("12 families"). The scope draft is
 * edited in the band below; the sentence reads what is APPLIED, never the draft.
 */
function FamiliesHead() {
  const {
    store,
    profilePath,
    applied,
    plan,
    includedPlanned,
    outsideProfile,
    matrixIssue,
    totalFamilies,
  } = useFamiliesWorkspace();
  const ladder = useDocumentLadder(store.handle);
  const document = <Picker levels={ladder.levels} disabled={store.handle.busy !== null} />;
  // An empty familyNames list means every family the categories resolve to: read the resolved count.
  const scoped = applied ? applied.familyNames.length || totalFamilies : 0;
  const profileName = profilePath?.split(/[\\/]/).at(-1) ?? null;
  const warnings = plan?.entries.reduce((sum, entry) => sum + entry.warnings.length, 0) ?? 0;
  const profile = (
    <SituationCell io="r" empty={!profilePath}>
      <Picker
        title={profilePath ? `${profilePath}; pick to change` : "choose a profile"}
        levels={[
          {
            key: "profile",
            label: profileName,
            placeholder: "choose a profile",
            options: store.feeds.profile.options,
            note:
              store.feeds.profile.state === "error"
                ? "the host did not list its profiles"
                : "reading profiles…",
            picked: (id) => id === profilePath,
            pick: (id) => void store.actions.setProfile(id),
          },
        ]}
      />
    </SituationCell>
  );
  const scope = (
    <SituationCell io={store.page.stage === "review" ? "w" : "r"} empty={!applied}>
      {/* Read, not operable: no dotted mark. Dashed only while nothing is applied. */}
      <span
        className={applied ? undefined : "border-b seam-border border-current text-ink-2"}
        title={
          applied
            ? `${applied.placementScope} · ${applied.categoryNames.join(", ") || "every category"}; the scope draft below changes it`
            : "no scope applied; draft one below and apply it"
        }
      >
        {applied ? noun(scoped, "family") : "no scope"}
      </span>
    </SituationCell>
  );
  return (
    <Situation
      handle={store.handle}
      target={{ session: ladder.sessionWord, document: ladder.docWord }}
      health={matrixIssue ? `${matrixIssue.title} · ${matrixIssue.message}` : null}
      commit="apply"
      sentence={
        <>
          {profile} over {scope} in {document}.
        </>
      }
      band={
        plan ? (
          <div className="hairline-t hairline-b flex items-baseline justify-between gap-6 py-2 t-prose">
            <span>
              <b>
                {includedPlanned.length} / {plan.entries.length} included
              </b>
              {store.handle.work.revision !== null ? (
                <span className="face-mono text-ink-mute"> r{store.handle.work.revision}</span>
              ) : null}
            </span>
            <span className="flex gap-4 text-ink-2">
              {outsideProfile.length ? <span>{outsideProfile.length} unclaimed</span> : null}
              {warnings ? <span data-tone="caution">{noun(warnings, "warning")}</span> : null}
            </span>
          </div>
        ) : null
      }
      ledger={[
        ["profile", profilePath ?? "none"],
        [
          "scope",
          applied
            ? `${applied.placementScope} · ${applied.categoryNames.join(", ") || "every category"} · ${noun(scoped, "family")}`
            : "none applied",
        ],
        ["plan", plan ? `${noun(plan.entries.length, "entry")} on the current basis` : "none"],
        ["applied", store.applyData ? store.applyData.appliedAt : "never"],
      ]}
    />
  );
}

export function FamiliesWorkspaceView() {
  const { store } = useFamiliesWorkspace();
  return (
    <Surface
      head={<RouteShell manifest={manifest} handle={store.handle} situation={<FamiliesHead />} />}
    >
      <div data-slot="readout-band" className="shrink-0 py-1.5">
        <FamiliesFilterBand />
        <FamiliesReadoutBands />
      </div>
      <Pane
        kind="content"
        title="families"
        help="Families and types in the applied scope. Filter or open a row to inspect its authored family."
        scroll="clip"
        flush
        headerless
      >
        <FamiliesMatrix />
      </Pane>
    </Surface>
  );
}
