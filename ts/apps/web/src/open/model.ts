/**
 * Open's derivations, pure: the documents table (recents of every installed year merged with what
 * each Revit holds now) and the launch plan (what the launcher would do, why it refuses, and the
 * exact commands the host runs). The argv comes from the SDK's own generated builders, so the
 * printed line and the dispatched line cannot drift.
 */
import type { InstancesLaunch, Machine, MachineSession } from "@pe/agent-contracts";
import {
  docOpenArgv,
  sessionStartArgv,
  type RecentDocument,
} from "@pe/host-contracts/pe-revit-contract";

import { keyOf, phaseOf, pidOf, selectionOf } from "#/machine/session";

export type HeldModel = NonNullable<MachineSession["documents"]>[number];

export interface DocRow {
  readonly key: string;
  readonly title: string;
  readonly path: string;
  /** The SDK `doc open` source: local path, or the exact `cld://` identity. */
  readonly selector: string;
  readonly cloud: boolean;
  readonly savedYear: number | null;
  readonly savedYearFailure: string | null;
  /** The Revit year whose recents list it, when one does. */
  readonly lastYear: number | null;
  readonly openIn: { readonly session: MachineSession; readonly document: HeldModel } | null;
}

/**
 * The SDK's `doc open` source for one MRU row: the local path, or the exact `cld://` identity when
 * Revit.ini carries it. Never a bare title when identity exists — substring matching refused
 * `…ProjectA_R25` because the title prefixes its detached clones (field, 2026-09-01).
 */
export const docSelectorOf = (recent: RecentDocument): string =>
  !recent.isCloud
    ? recent.path
    : recent.region && recent.projectGuid && recent.modelGuid
      ? `cld://${recent.region}/{${recent.projectGuid}}p/{${recent.modelGuid}}${encodeURIComponent(recent.title)}.rvt`
      : recent.path.startsWith("cld:")
        ? recent.path
        : `recent:${recent.title}`;

const same = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function modelRows(
  sessions: readonly MachineSession[],
  recents: readonly RecentDocument[],
): DocRow[] {
  const held = sessions.flatMap((session) =>
    (session.documents ?? []).map((document) => ({ session, document })),
  );
  const claimed = new Set<(typeof held)[number]>();
  const rows: DocRow[] = [];
  for (const recent of recents) {
    if (rows.some((row) => same(row.path, recent.path))) continue;
    const open =
      held.find(
        (entry) =>
          same(entry.document.path, recent.path) ||
          (recent.isCloud && same(entry.document.title, recent.title)),
      ) ?? null;
    if (open) claimed.add(open);
    rows.push({
      key: recent.path,
      title: recent.title,
      path: recent.path,
      selector: docSelectorOf(recent),
      cloud: recent.isCloud,
      savedYear: recent.savedYear,
      savedYearFailure: recent.savedYearFailure,
      lastYear: recent.year,
      openIn: open,
    });
  }
  for (const entry of held)
    if (!claimed.has(entry) && entry.document.path)
      rows.push({
        key: entry.document.path,
        title: entry.document.title ?? entry.document.path,
        path: entry.document.path,
        selector: entry.document.path,
        cloud: entry.document.persistence === "cloud",
        savedYear: null,
        savedYearFailure: null,
        lastYear: null,
        openIn: entry,
      });
  return rows;
}

/** The launcher's own picks. `target` is a Running key, or "new" for a new Revit. */
export interface LaunchDraft {
  readonly doc: string | null;
  readonly year: number | null;
  readonly target: string | null;
  readonly posture: "foreground" | "background";
  readonly quarantine: boolean;
  readonly name: string;
  readonly missingLinks: "refuse" | "allow";
}

export const EMPTY_DRAFT: LaunchDraft = {
  doc: null,
  year: null,
  target: null,
  posture: "foreground",
  quarantine: false,
  name: "",
  missingLinks: "refuse",
};

export interface LaunchPlan {
  readonly doc: DocRow | null;
  readonly year: number | null;
  readonly live: readonly MachineSession[];
  readonly target: MachineSession | null;
  readonly verb: string;
  readonly argv: readonly string[];
  readonly refusal: string | null;
  readonly caution: string | null;
  readonly note: string | null;
  readonly launch: InstancesLaunch | null;
}

const cli = (argv: string[]) =>
  `pe-revit ${argv
    .filter((arg) => arg !== "--json")
    .map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))
    .join(" ")}`;

/** `session start --id` accepts ≤64 chars of letters, digits, `.`, `-`, `_`. */
export const sessionIdOf = (name: string) =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

export function launchPlan(
  draft: LaunchDraft,
  machine: Machine | null,
  rows: readonly DocRow[],
): LaunchPlan {
  const sessions = machine?.revit.sessions ?? [];
  const years = machine?.revit.years ?? [];
  const doc = rows.find((row) => row.key === draft.doc) ?? null;
  // The default year is an installed one: the file's own, else the one that last opened it.
  const installed = (candidate: number | null | undefined) =>
    candidate != null && years.includes(candidate) ? candidate : null;
  const year =
    draft.year ??
    (doc?.openIn
      ? doc.openIn.session.row.year
      : (installed(doc?.savedYear) ?? installed(doc?.lastYear))) ??
    (years.length ? Math.max(...years) : null);
  const live = sessions.filter((session) => session.row.year === year && pidOf(session.row));
  const ready = live.find((session) => phaseOf(session.row) === "ready");
  const picked =
    draft.target === "new"
      ? null
      : (live.find((session) => keyOf(session) === draft.target) ??
        (draft.target === null
          ? doc?.openIn && doc.openIn.session.row.year === year
            ? doc.openIn.session
            : doc
              ? (ready ?? null)
              : null
          : null));
  const upgrade = !!(doc?.savedYear && year && doc.savedYear < year);
  const checkout = machine?.host?.payload === "checkout" && machine.host.sourceRoot;
  const project = checkout
    ? `${machine!.host!.sourceRoot}\\dotnet\\Pe.App\\Pe.App.csproj`
    : undefined;
  const name = sessionIdOf(draft.name);
  const background = draft.posture === "background";
  const nonDefault = draft.posture === "background" || draft.quarantine;
  let refusal: string | null = null;
  let caution: string | null = null;
  let note: string | null = null;
  if (year === null)
    refusal = "No installed Revit year is known yet; the machine reading has none.";
  else if (doc?.savedYear && doc.savedYear > year)
    refusal = `${doc.title} was saved in Revit ${doc.savedYear}; Revit ${year} cannot open a newer file.`;
  else if (doc?.openIn)
    refusal = `${doc.title} is already open in Revit ${doc.openIn.session.row.year} (pid ${pidOf(doc.openIn.session.row)}).`;
  else if (picked && phaseOf(picked.row) !== "ready")
    refusal = `Revit ${year} pid ${pidOf(picked.row)} is ${phaseOf(picked.row)}; it opens nothing until it answers.`;
  else if (!doc && picked)
    refusal = "Pick a document to open in this Revit, or choose a new Revit.";
  if (upgrade)
    caution = `Saved in ${doc!.savedYear}. Opening in ${year} upgrades it; once saved it will not open in ${doc!.savedYear} again.`;
  else if (doc && !doc.savedYear && doc.savedYearFailure)
    caution = `Saved year unknown (${doc.savedYearFailure}). Revit decides when it opens.`;
  if (picked?.row.case === "observed-active")
    note = `This Revit was started from its icon. Opening through it adopts it by pid ${picked.row.process.pid}.`;
  else if (!picked && doc && nonDefault)
    note =
      "open --start takes no posture or add-ins flag, so this is two commands: start, then open.";
  const links = draft.missingLinks;
  let verb: string;
  let argv: string[];
  let launch: InstancesLaunch | null = null;
  if (picked && doc) {
    const selection = selectionOf(picked.row);
    verb = `Open in Revit ${year}`;
    argv = [
      ...(picked.row.case === "observed-active"
        ? [cli(sessionStartArgv({ pid: picked.row.process.pid }))]
        : []),
      cli(docOpenArgv({ source: doc.selector, ...selection, links, conflict: "keep" })),
    ];
    launch = { kind: "open", session: selection, document: doc.selector, missingLinks: links };
  } else {
    verb = doc ? `Start Revit ${year} and open` : `Start Revit ${year ?? ""}`.trim();
    argv = [
      cli(
        sessionStartArgv({
          project,
          year: year === null ? undefined : String(year),
          id: name || undefined,
          background,
          quarantine: draft.quarantine,
        }),
      ),
      ...(doc
        ? [
            cli(
              docOpenArgv({
                source: doc.selector,
                id: name || "<minted>",
                links,
                conflict: "keep",
              }),
            ),
          ]
        : []),
    ];
    launch =
      year === null
        ? null
        : {
            kind: "start",
            year: String(year),
            name,
            document: doc?.selector,
            quarantine: draft.quarantine,
            posture: draft.posture,
            missingLinks: links,
          };
  }
  return { doc, year, live, target: picked, verb, argv, refusal, caution, note, launch };
}
