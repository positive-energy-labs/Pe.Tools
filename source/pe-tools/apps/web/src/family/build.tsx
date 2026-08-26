/**
 * /family — THE BUILD LANE: the crossing that materializes the open family.json into a real .rfa.
 *
 * SETTLED LAW, verbatim: "Materialize ceremony: foundry-grade — human-readable
 * reason, planHash-style drift refusal, receipts — presented as an arming preview strip. Never
 * hover-height." This module is that ruling, and nothing else lives here.
 *
 * WHY THE REFUSALS ARE PURE FUNCTIONS AND NOT `disabled` EXPRESSIONS. The build reads the SAVED
 * document — `build_evidence` re-opens it host-side through `settings.document.open` and hands its
 * `rawContent` to `revit.apply.family-model`. So every fact that decides whether the file on disk
 * is the file the table is showing is a fact the ceremony has to STATE, not merely obey: a greyed
 * verb with a hover reason would be exactly the "hover-height" presentation the ruling forbids.
 * `buildRefusals` is therefore the whole safety model in one testable place, and the strip renders
 * its words.
 *
 *   unsaved      the draft (or a staged field) carries values the file does not → the build would
 *                build something other than what the table shows. Exit: save profile.
 *   invalid      the host's own schema verdict on the SAVED document is false → the build feeds
 *                that same file to Revit. Its first issue is quoted verbatim.
 *   unbound      no session bound. The build runs INSIDE Revit; there is nowhere to run it.
 *   superseded   THE planHash-STYLE DRIFT REFUSAL. The strip is armed against a version token; if
 *                the document is saved underneath it, the .rfa this would build is not the one the
 *                strip described. The token IS the plan hash — there is no separate plan to hash,
 *                because the document at a revision is the plan.
 *   no-document  the fixture lane has no file behind it. Defensive: the verb is already dark there.
 *
 * WHAT THE STRIP CANNOT SAY, and how this file adapts without touching the primitive (findings for
 * the design pass):
 *   1. `ArmingState.refused` carries ONE refusal string. Several can be true at once (a dirty draft
 *      AND a schema failure), so they are JOINED here. A refusal LIST is the honest shape.
 *   2. There is no in-flight phase. A write that leaves the page and takes seconds inside Revit has
 *      to say so at strip scale, so the slot renders `OutcomeLine kind="busy"` in the strip's place
 *      while the command is out. The verb also wears `busy`, which is the house pattern.
 *   3. There is no UNKNOWN-OUTCOME phase. `build_evidence` mutates outside the page (it writes a
 *      file), so a command that returns without a receipt is not a success and not a refusal — it
 *      is unprovable. It is latched onto the refusal channel, worded as unknown rather than as no.
 *   4. `re-plan` is the only exit the refused phase offers, and for these refusals re-planning is
 *      genuinely all it can do: re-arm against the file as it now stands. If you saved in the
 *      meantime the refusal clears; if you did not, it comes straight back. Pressing it never
 *      writes anything — which is why it is safe to give every refusal the same exit.
 */
import { ArmingStrip, type ArmingState } from "#/components/lang/arming-strip";
import { OutcomeLine } from "#/components/lang/outcome";

/** The commit label, shared by the verb that arms and the strip that commits. */
export const BUILD_VERB = "build .rfa";

type BuildRefusalCode =
  | "no-document"
  | "unbound"
  | "unsaved"
  | "invalid"
  | "superseded"
  | "host"
  /** The command answered without proving anything. Not a no; unprovable. */
  | "unknown";

export interface BuildRefusal {
  code: BuildRefusalCode;
  says: string;
}

/**
 * Everything the ceremony reads, flattened out of the lane and the store. Flat and serialisable on
 * purpose: the predicates below are the safety model, and a safety model that needs a React tree to
 * evaluate is a safety model nobody can test.
 */
export interface BuildFacts {
  /** The open document's path — null on the fixture lane, where there is no file to build. */
  relativePath: string | null;
  /** The saved revision. Doubles as the plan hash: the document at a revision IS the plan. */
  versionToken: string | null;
  /** The host's schema verdict on the SAVED document. */
  validation: { isValid: boolean; issues: unknown[] } | null;
  /** Page-draft values that are not on disk. */
  unsavedCount: number;
  /** Fields staged onto `route:settings` but not yet written. */
  stagedCount: number;
  /** The bound Revit session, "" when nothing is bound. */
  boundTarget: string;
  /** The token the strip was armed against; null while unarmed. */
  armedToken: string | null;
}

/**
 * The .rfa the default build writes, mirroring `build_evidence`'s own default exactly — including
 * the `.json` that stays in the middle of the name, because the host builds it from the relative
 * path verbatim. `<timestamp>` is a literal: the host stamps it, and a surface that invented a
 * timestamp would be naming a file that does not exist. The stamp is not decoration —
 * `revit.apply.family-model` refuses to overwrite, so a fixed name would Conflict on every rebuild.
 */
export function buildOutputPath(relativePath: string): string {
  return `.artifacts/tmp/family/${relativePath.replace(/\//g, "-")}-<timestamp>.rfa`;
}

/** WHICH family, from WHICH document, to WHICH .rfa — the human-readable reason, in one line. */
export function buildTarget(facts: BuildFacts, familyName: string): string {
  if (facts.relativePath == null) return `${familyName} · no document open`;
  return `${familyName} · ${facts.relativePath} → ${buildOutputPath(facts.relativePath)}`;
}

/** The plan hash the refusal cites. The version token is it — see `superseded`. */
export function buildPlanHash(versionToken: string | null): string {
  return versionToken == null ? "untokened" : `v${versionToken}`;
}

/** One host issue as words. Issues are `unknown` on the wire; a shape check beats a cast. */
export function issueText(issue: unknown): string {
  if (typeof issue === "string") return issue;
  if (typeof issue === "object" && issue != null && "message" in issue)
    return String((issue as { message: unknown }).message);
  return JSON.stringify(issue);
}

/**
 * EVERY reason this build would be dishonest, worst first. Empty means the strip may arm.
 *
 * Ordering is by what has to be fixed first rather than by severity: a fixture lane makes the rest
 * of the questions meaningless, and an unbound session makes the file's state irrelevant.
 */
export function buildRefusals(facts: BuildFacts): BuildRefusal[] {
  const refusals: BuildRefusal[] = [];

  if (facts.relativePath == null) {
    refusals.push({
      code: "no-document",
      says:
        "No family.json is open — this page is reading its declared fixture, which has no file behind it. " +
        "The build materializes a SAVED document, so there is nothing here to materialize. " +
        "Exit: pick a document in the sentence.",
    });
    return refusals;
  }

  if (facts.boundTarget === "")
    refusals.push({
      code: "unbound",
      says:
        "No Revit session is bound, and the build runs INSIDE Revit — it opens the saved document host-side " +
        "and writes the .rfa there. There is nowhere to run it. Exit: bind a world in the sentence's clause.",
    });

  if (facts.unsavedCount > 0 || facts.stagedCount > 0)
    refusals.push({
      code: "unsaved",
      says:
        `The build reads the SAVED document, and the page carries ${describeUnsaved(facts)} the file does not — ` +
        `so building now would build something other than what the table shows, and the receipt would name the ` +
        `wrong revision. Exit: save profile first, then re-plan.`,
    });

  if (facts.validation != null && facts.validation.isValid === false)
    refusals.push({
      code: "invalid",
      says: `The host reports the saved document does not validate: ${
        facts.validation.issues.length === 0
          ? "no issue was itemised, which is itself a reason not to build"
          : issueText(facts.validation.issues[0])
      }. The build would hand that same file to Revit. Exit: fix it, save, then re-plan.`,
    });

  // THE DRIFT REFUSAL. Only meaningful once armed — an unarmed strip has no plan to supersede.
  if (facts.armedToken !== null && facts.armedToken !== facts.versionToken)
    refusals.push({
      code: "superseded",
      says:
        `This plan was armed against ${buildPlanHash(facts.armedToken)}; the document is now ` +
        `${buildPlanHash(facts.versionToken)}. It was saved underneath the plan, so the .rfa this would build ` +
        `is not the one the strip described. Re-plan to arm against the file as it stands.`,
    });

  return refusals;
}

function describeUnsaved(facts: BuildFacts): string {
  const parts: string[] = [];
  if (facts.unsavedCount > 0)
    parts.push(`${facts.unsavedCount} draft value${facts.unsavedCount === 1 ? "" : "s"}`);
  if (facts.stagedCount > 0)
    parts.push(`${facts.stagedCount} staged field${facts.stagedCount === 1 ? "" : "s"}`);
  return `${parts.join(" and ")} that`;
}

/** The receipt `build_evidence` returns, read defensively — the wire type is `unknown`. */
interface BuildReceipt {
  familyName: string;
  rfaPath: string;
  documentVersionToken: string | null;
  parameterCount: number | null;
}

/**
 * Null means the command answered without proving anything, which is NOT a success: the file may
 * or may not be on disk. The caller latches that as an unknown outcome rather than a receipt.
 */
export function readBuildReceipt(result: unknown): BuildReceipt | null {
  if (typeof result !== "object" || result == null) return null;
  const record = result as Record<string, unknown>;
  const rfaPath = record.rfaPath;
  if (typeof rfaPath !== "string" || rfaPath === "") return null;
  return {
    familyName: typeof record.familyName === "string" ? record.familyName : "the family",
    rfaPath,
    documentVersionToken:
      typeof record.documentVersionToken === "string" ? record.documentVersionToken : null,
    parameterCount: typeof record.parameterCount === "number" ? record.parameterCount : null,
  };
}

/** What the surface says when it cannot vouch for its own write (finding 3 above). */
export const BUILD_OUTCOME_UNKNOWN =
  "OUTCOME UNKNOWN — the build command returned without a receipt, so this surface cannot say whether " +
  "the .rfa was written. It writes a NEW timestamped file rather than overwriting, so a second build " +
  "cannot undo a first one: look in .artifacts/tmp/family before pressing again.";

interface BuildStripProps {
  /** null → unarmed; the strip is not on the page at all. */
  armed: { token: string | null; reason: string } | null;
  /** The command is out. Nothing about the .rfa is known yet. */
  building: boolean;
  /** A host failure or latched unknown outcome. Outranks the local predicates. */
  said: BuildRefusal | null;
  facts: BuildFacts;
  familyName: string;
  /** Parameters the SAVED document carries — what the build writes into the .rfa. */
  count: number;
  onReasonChange: (reason: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  /** Re-arm against the file as it now stands. Writes nothing. */
  onReplan: () => void;
  className?: string;
}

/**
 * THE CEREMONY SLOT, in the pane that owns the crossing. Renders nothing until the verb arms it —
 * an arming strip that is always on screen is a form, not a ceremony.
 */
export function BuildStrip({
  armed,
  building,
  said,
  facts,
  familyName,
  count,
  onReasonChange,
  onCommit,
  onCancel,
  onReplan,
  className,
}: BuildStripProps) {
  if (building)
    return (
      <OutcomeLine
        className={className}
        kind="busy"
        label={BUILD_VERB}
        says={`opening ${facts.relativePath ?? "the document"} inside Revit and writing the .rfa — this write leaves the page, so nothing here can be undone by cancelling`}
      />
    );
  if (armed == null) return null;

  const refusals = said != null ? [said] : buildRefusals({ ...facts, armedToken: armed.token });
  const state: ArmingState =
    refusals.length === 0
      ? { phase: "arming" }
      : {
          phase: "refused",
          // FINDING 1: the primitive carries one string; several refusals can be true at once.
          refusal: refusals.map((refusal) => refusal.says).join(" · "),
          onReplan,
        };

  return (
    <ArmingStrip
      className={className}
      verb={BUILD_VERB}
      target={buildTarget(facts, familyName)}
      count={count}
      planHash={buildPlanHash(armed.token)}
      reason={armed.reason}
      onReasonChange={onReasonChange}
      state={state}
      onCommit={onCommit}
      onCancel={onCancel}
    />
  );
}
