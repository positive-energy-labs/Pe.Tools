/**
 * Open's derivations, pure: the documents table (recents of every installed year merged with what
 * each Revit holds now) and the launch plan (what the patch bay would do, why it refuses, and the
 * exact commands the host runs). The argv comes from the SDK's own generated builders, so the
 * printed line and the dispatched line cannot drift.
 */
import type {
  MachineAccess,
  HarnessThreadSummary,
  InstancesLaunch,
  InstancesStart,
  Machine,
  MachineSession,
} from "@pe/agent-contracts";
import { launchUnsynced } from "@pe/agent-contracts";
import {
  docOpenArgv,
  sessionStartArgv,
  type RecentDocument,
} from "@pe/host-contracts/pe-revit-contract";

import type { SessionDocument } from "#/components/lang/session";
import { executionRefusal, keyOf, phaseOf, pidOf, selectionOf } from "#/machine/session";

type HeldModel = NonNullable<MachineSession["documents"]>[number];

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
const docSelectorOf = (recent: RecentDocument): string =>
  !recent.isCloud
    ? recent.path
    : recent.region && recent.projectGuid && recent.modelGuid
      ? `cld://${recent.region}/{${recent.projectGuid}}p/{${recent.modelGuid}}${encodeURIComponent(recent.title)}.rvt`
      : recent.path.startsWith("cld:")
        ? recent.path
        : `recent:${recent.title}`;

const same = (a: string | null | undefined, b: string | null | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

function cloudIdentity(value: {
  path: string | null;
  region?: string | null;
  projectGuid?: string | null;
  modelGuid?: string | null;
}): string | null {
  const path = /^cld:\/\/([^/]+)\/([^/]+)\/([^/]+)$/i.exec(value.path ?? "");
  const guid = (segment: string | undefined) => segment?.match(/^\{([^}]+)\}/)?.[1] ?? segment;
  const region = value.region ?? path?.[1];
  const project = value.projectGuid ?? guid(path?.[2]);
  const model = value.modelGuid ?? guid(path?.[3]);
  return region && project && model
    ? JSON.stringify([region, project, model].map((part) => part.toLowerCase()))
    : null;
}

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
    const identity = recent.isCloud ? cloudIdentity(recent) : null;
    if (
      rows.some((row) =>
        identity ? identity === cloudIdentity({ path: row.selector }) : same(row.path, recent.path),
      )
    )
      continue;
    const open =
      held.find((entry) =>
        identity
          ? identity === cloudIdentity(entry.document)
          : same(entry.document.path, recent.path),
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

/**
 * A row for a pasted source the recents do not know: an absolute path, a UNC path, or a `cld://`
 * identity. Null for anything else (a search word stays a search word).
 */
export function pathRow(text: string): DocRow | null {
  const source = text.trim().replace(/^"|"$/g, "");
  if (!/^(?:[A-Za-z]:[\\/]|\\\\|cld:\/\/)/i.test(source)) return null;
  const cloud = source.toLowerCase().startsWith("cld://");
  if (!cloud && !/\.(rvt|rfa|rte|rft)$/i.test(source)) return null;
  return {
    key: source,
    title: decodeURIComponent(source.split(/[\\/]/).at(-1) ?? source).replace(/^\{[^}]*\}/, ""),
    path: source,
    selector: source,
    cloud,
    savedYear: null,
    savedYearFailure: null,
    lastYear: null,
    openIn: null,
  };
}

/** The patch bay's picks: a jack, a socket, and the free socket's shape. Nothing is derived. */
export interface LaunchDraft {
  /** A discovered row key, or a pasted source the table does not list. */
  readonly doc: string | null;
  /** A session key (`keyOf`), "new" for the free socket, or null: nothing patched yet. */
  readonly target: string | null;
  /** The free socket's year; null takes the default for the picked document. */
  readonly year: number | null;
  readonly owner: "you" | "pea";
  readonly addins: "on" | "off";
  /** The cable adapter: open detached from central (workshared and cloud models). */
  readonly detach: boolean;
  readonly links: "refuse" | "allow";
}

export const EMPTY_DRAFT: LaunchDraft = {
  doc: null,
  target: null,
  year: null,
  owner: "you",
  addins: "on",
  detach: false,
  links: "refuse",
};

/** The one action a press runs, with the input it takes (ADR 0016: nothing is staged first). */
type PlannedLaunch =
  | { readonly key: "instances.open"; readonly input: InstancesLaunch }
  | { readonly key: "instances.start"; readonly input: InstancesStart };

export interface LaunchPlan {
  readonly doc: DocRow | null;
  /** The Revit year the plan opens in: the socket's, or the free socket's. */
  readonly year: number | null;
  /** The patched running Revit; null for the free socket or nothing patched. */
  readonly target: MachineSession | null;
  readonly whose: "you" | "pea";
  readonly upgrade: boolean;
  /** The one button: every consequence in its words. */
  readonly verb: string;
  readonly argv: readonly string[];
  readonly refusal: string | null;
  /** Nothing is wrong, but nothing is patched yet. */
  readonly waiting: string | null;
  /** What the press will also do, said before it is pressed. */
  readonly cautions: readonly { tone: "caution" | "pea" | "commit"; text: string }[];
  readonly launch: PlannedLaunch | null;
}

const cli = (argv: string[]) =>
  `pe-revit ${argv
    .filter((arg) => arg !== "--json")
    .map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))
    .join(" ")}`;

/** A known file year requires an exact installed match. An upgrade is an explicit choice. */
export function defaultYear(doc: DocRow | null, years: readonly number[]): number | null {
  if (!years.length) return null;
  const sorted = [...years].sort((a, b) => a - b);
  const saved = doc?.savedYear ?? null;
  if (saved !== null) return years.includes(saved) ? saved : null;
  if (doc?.lastYear && years.includes(doc.lastYear)) return doc.lastYear;
  return sorted.at(-1)!;
}

/** The row a draft names: a discovered row, else a pasted source as its own row. */
function docOf(draft: LaunchDraft, rows: readonly DocRow[]): DocRow | null {
  if (!draft.doc) return null;
  const identity = cloudIdentity({ path: draft.doc });
  return (
    rows.find(
      (row) =>
        same(row.key, draft.doc) ||
        same(row.selector, draft.doc) ||
        (identity !== null && identity === cloudIdentity({ path: row.selector })),
    ) ??
    pathRow(draft.doc) ?? {
      key: draft.doc,
      title: draft.doc.split(/[\\/]/).at(-1) ?? draft.doc,
      path: draft.doc,
      selector: draft.doc,
      cloud: draft.doc.toLowerCase().startsWith("cld://"),
      savedYear: null,
      savedYearFailure: null,
      lastYear: null,
      openIn: null,
    }
  );
}

export function launchPlan(
  draft: LaunchDraft,
  machine: Machine | null,
  rows: readonly DocRow[],
): LaunchPlan {
  const sessions = machine?.revit.sessions ?? [];
  const years = machine?.revit.years ?? [];
  const doc = docOf(draft, rows);
  const target =
    draft.target && draft.target !== "new"
      ? (sessions.find((session) => keyOf(session) === draft.target) ?? null)
      : null;
  const whose = target ? target.whose : draft.owner;
  const pea = whose === "pea";
  const year = target
    ? target.row.year
    : draft.target === "new"
      ? (draft.year ?? defaultYear(doc, years))
      : defaultYear(doc, years);
  const saved = doc?.savedYear ?? null;
  const upgrade = saved !== null && year !== null && saved < year;
  const newest = years.length ? Math.max(...years) : null;
  const checkout = machine?.host?.payload === "checkout" && machine.host.sourceRoot;
  const project = checkout
    ? `${machine!.host!.sourceRoot}\\dotnet\\Pe.App\\Pe.App.csproj`
    : undefined;
  // Pea's copy of a cloud or workshared model is detached by the host; the person chooses.
  const detach = pea ? doc?.cloud === true || draft.detach : draft.detach;
  const background = pea;
  const links = draft.links;

  let refusal: string | null = null;
  let waiting: string | null = null;
  if (doc && saved !== null && newest !== null && saved > newest)
    refusal = `${doc.title} was saved in Revit ${saved}; the newest Revit here is ${newest}.`;
  else if (draft.target && draft.target !== "new" && !target)
    refusal = `Revit '${draft.target}' is no longer running; patch another socket.`;
  else if (year === null)
    refusal =
      saved !== null && years.length
        ? `Revit ${saved} is not installed. Choose an installed year explicitly to upgrade a copy.`
        : "No installed Revit year is known yet; the machine reading has none.";
  else if (doc && saved !== null && saved > year)
    refusal = `${doc.title} was saved in Revit ${saved}; Revit ${year} cannot open a newer file.`;
  else if (target && executionRefusal(target.row)) refusal = executionRefusal(target.row);
  else if (target && phaseOf(target.row) !== "ready")
    refusal = `Revit ${year} pid ${pidOf(target.row)} is ${phaseOf(target.row)}; it opens nothing until it answers.`;
  else if (
    doc?.openIn &&
    !pea &&
    (doc.openIn.session === target || (!target && doc.openIn.session.whose === "you"))
  )
    refusal = `${doc.title} is already open in Revit ${doc.openIn.session.row.year} (pid ${pidOf(doc.openIn.session.row)}).`;
  else if (!draft.target && doc)
    waiting = "Patch it into a Revit on the right, or the free socket.";
  else if (!doc && target) waiting = "Pick a document on the left to open in this Revit.";

  const cautions: { tone: "caution" | "pea" | "commit"; text: string }[] = [];
  if (doc && upgrade && !pea)
    cautions.push({
      tone: "caution",
      text: `Saved in ${saved}. Revit ${year} upgrades it; once saved it never opens in ${saved} again.`,
    });
  if (doc && upgrade && pea)
    cautions.push({
      tone: "pea",
      text: `Pea's copy upgrades to ${year}. Your file stays ${saved}.`,
    });
  if (doc && !saved && doc.savedYearFailure)
    cautions.push({
      tone: "caution",
      text: `Saved year unknown (${doc.savedYearFailure}). Revit decides when it opens.`,
    });
  if (doc && pea)
    cautions.push({
      tone: "pea",
      text: doc.cloud
        ? "Pea gets a detached copy. Nothing reaches central."
        : "Pea works on a copy in its own folder; your file is untouched.",
    });
  if (doc && detach && !pea)
    cautions.push({ tone: "caution", text: "Detached: your edits never sync to central." });
  if (doc && links === "allow")
    cautions.push({ tone: "caution", text: "Missing linked models open unloaded." });
  if (target?.row.case === "observed-active")
    cautions.push({
      tone: "commit",
      text: `This Revit was started from its icon. Opening through it adopts it by pid ${target.row.process.pid}.`,
    });
  if (!target && draft.target === "new" && draft.addins === "off")
    cautions.push({ tone: "commit", text: "Third-party add-ins stay off in the new Revit." });

  // The verb names every consequence; pressing it is the consent.
  const where = target
    ? `${pea ? "Pea's" : "your"} Revit ${year}`
    : `a new ${pea ? "background " : ""}Revit ${year ?? ""}`.trim();
  const consequences = [
    upgrade && !pea ? `upgrade from ${saved}` : null,
    detach && !pea ? "detached" : null,
    links === "allow" ? "allowing missing links" : null,
    !target && draft.addins === "off" ? "with add-ins off" : null,
  ].filter((each): each is string => each !== null);
  const tail = consequences.length ? ` and ${consequences.join(", ")}` : "";
  const verb = !doc
    ? target
      ? `Open a document in ${where}`
      : `Start ${where}${tail}`
    : `${pea ? "Give Pea a copy in" : "Open in"} ${where}${tail}`;

  let argv: string[] = [];
  let launch: PlannedLaunch | null = null;
  if (target && doc) {
    const selection = selectionOf(target.row);
    argv = [
      ...(target.row.case === "observed-active"
        ? [cli(sessionStartArgv({ pid: target.row.process.pid }))]
        : []),
      cli(
        docOpenArgv({
          source: doc.selector,
          ...selection,
          detach,
          upgrade,
          links,
          unsynced: launchUnsynced({ source: doc.selector }),
        }),
      ),
    ];
    launch = {
      key: "instances.open",
      input: { source: doc.selector, into: { session: selection }, detach, upgrade, links },
    };
  } else if (draft.target === "new" && year !== null) {
    const start: InstancesStart = {
      year: String(year),
      owner: draft.owner,
      addins: draft.addins,
    };
    argv = [
      cli(
        sessionStartArgv({
          project,
          year: String(year),
          background,
          quarantine: draft.addins === "off",
        }),
      ),
      ...(doc
        ? [
            cli(
              docOpenArgv({
                source: doc.selector,
                id: "<minted>",
                detach,
                upgrade,
                links,
                unsynced: launchUnsynced({ source: doc.selector }),
              }),
            ),
          ]
        : []),
    ];
    launch = doc
      ? {
          key: "instances.open",
          input: { source: doc.selector, into: { start }, detach, upgrade, links },
        }
      : { key: "instances.start", input: start };
  }
  if (refusal || waiting) launch = null;
  return { doc, year, target, whose, upgrade, verb, argv, refusal, waiting, cautions, launch };
}

export interface PeaJob {
  readonly thread: HarnessThreadSummary;
  readonly session: MachineSession;
  readonly openId: string | null;
}

/** Thread activity in Pea's sessions; this conveys no write grant. */
export function jobsOf(
  threads: readonly HarnessThreadSummary[] | null,
  sessions: readonly MachineSession[],
): PeaJob[] {
  return (threads ?? []).flatMap((thread) => {
    const ref = thread.head.defaultTarget?.kind === "open" ? thread.head.defaultTarget.ref : null;
    if (!ref) return [];
    const session = sessions.find(
      (each) => each.whose === "pea" && each.attachment?.session === ref.session,
    );
    return session
      ? [
          {
            thread,
            session,
            openId: session.documents?.some((doc) => doc.openId === ref.openId) ? ref.openId : null,
          },
        ]
      : [];
  });
}

/**
 * What the host says may write an SDK-listed document. The host projects access per product
 * document; an unmatched SDK lifetime carries no product access observation.
 */
export const accessOf = (
  session: MachineSession,
  document: SessionDocument,
): MachineAccess | undefined =>
  session.attachment?.documents?.find((each) => each.openId === document.openId)?.access;
