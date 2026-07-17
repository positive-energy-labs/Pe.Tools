import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { callHostRpc } from "#/host/client";
import { HOST_QUERY_KEY, useHostOp } from "#/host/queries";
import type { RevitRecentDocumentEntry } from "@pe/host-contracts/operation-types";

/**
 * The .rvt / .rfa document chips — siblings of the session TargetChip. Together the three
 * chips read left-to-right as "which Revit → which project → which family". Same idiom as
 * the target chip: hairline chip button, 2px radius, tele type, dropdown panel of rows.
 *
 * Both chips take the bound session selector (`target`) and pass it on every host call;
 * with no binding they render muted and inert.
 */

const CHIP_STYLE = {
  active: { border: "1px solid var(--line-2)", color: "var(--foreground)" },
  empty: { border: "1px dashed var(--line)", color: "var(--muted-foreground)" },
} as const;

const BOGUS_CATEGORY_PARTS = ["Annotation", "Tag", "Title Block", "Detail Item", "Profile"];

function isBogusCategory(name: string | null | undefined): boolean {
  if (!name) return true;
  return BOGUS_CATEGORY_PARTS.some((part) => name.includes(part));
}

/** Recent documents narrowed to one extension, existing files only, deduped by path, by rank. */
function recentByExtension(
  documents: readonly RevitRecentDocumentEntry[] | undefined,
  extension: string,
): RevitRecentDocumentEntry[] {
  const seen = new Set<string>();
  return (documents ?? [])
    .filter((doc) => doc.path.toLowerCase().endsWith(extension) && doc.exists !== false)
    .filter((doc) => {
      const key = doc.path.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER));
}

/** Chip shell: tiny extension label + value, dropdown panel below, outside-click close. */
function DocChip({
  prefix,
  label,
  hasValue,
  disabled,
  open,
  onToggle,
  onClose,
  title,
  children,
}: {
  prefix: string;
  label: string;
  hasValue: boolean;
  disabled: boolean;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onClose]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        disabled={disabled}
        onClick={onToggle}
        title={disabled ? "bind a session first" : title}
        className="tele inline-flex h-7 items-center gap-1.5 px-2 disabled:opacity-40"
        style={{
          fontSize: 11,
          borderRadius: 2,
          ...(hasValue && !disabled ? CHIP_STYLE.active : CHIP_STYLE.empty),
        }}
      >
        <span
          className="font-[var(--font-pe-mono)]"
          style={{ fontSize: 9, letterSpacing: "0.08em", color: "var(--slate)" }}
        >
          {prefix}
        </span>
        <span className="max-w-44 truncate">{label}</span>
      </button>

      {open ? (
        <div
          className="absolute left-0 top-full z-30 mt-1 w-80"
          style={{
            border: "0.5px solid var(--line-2)",
            background: "var(--popover, var(--paper-2))",
            borderRadius: 2,
          }}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

function PanelHeader({ label, detail }: { label: string; detail: string }) {
  return (
    <div
      className="flex items-baseline justify-between px-3 py-1.5"
      style={{ borderBottom: "0.5px solid var(--line-soft)" }}
    >
      <span
        className="font-[var(--font-pe-mono)]"
        style={{ fontSize: 10, letterSpacing: "0.08em", color: "var(--foreground)" }}
      >
        {label.toUpperCase()}
      </span>
      <span
        className="truncate font-[var(--font-pe-mono)]"
        style={{ fontSize: 10, color: "var(--muted-foreground)", maxWidth: "60%" }}
      >
        {detail}
      </span>
    </div>
  );
}

function PanelRow({
  primary,
  secondary,
  onClick,
  disabled,
}: {
  primary: string;
  secondary?: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-baseline justify-between gap-2 px-3 py-1.5 text-left hover:bg-[var(--pe-blue)]/5 disabled:opacity-40"
      style={{ borderBottom: "0.5px solid var(--line-soft)" }}
    >
      <span className="truncate" style={{ fontSize: 12, color: "var(--foreground)" }}>
        {primary}
      </span>
      {secondary ? (
        <span
          className="shrink-0 whitespace-nowrap font-[var(--font-pe-mono)]"
          style={{ fontSize: 9, color: "var(--muted-foreground)" }}
        >
          {secondary}
        </span>
      ) : null}
    </button>
  );
}

function PanelNote({ text, tone = "muted" }: { text: string; tone?: "muted" | "error" }) {
  return (
    <div
      className="px-3 py-2"
      style={{ fontSize: 11, color: tone === "error" ? "var(--fail)" : "var(--muted-foreground)" }}
    >
      {text}
    </div>
  );
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Both chips share the session context + the "open then refetch" action loop. */
function useDocumentSession(target: string, open: boolean) {
  const queryClient = useQueryClient();
  const session = useHostOp("revit.context.document-session", undefined, {
    bridgeSessionId: target || undefined,
    enabled: Boolean(target),
    staleTime: 10_000,
  });
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (open) setActionError(null);
  }, [open]);

  const run = async (action: () => Promise<unknown>, onDone: () => void) => {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      for (const key of ["revit.context.document-session", "revit.catalog.loaded-families"])
        void queryClient.invalidateQueries({ queryKey: [...HOST_QUERY_KEY, target, key] });
      onDone();
    } catch (caught) {
      setActionError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  return { session, busy, actionError, run };
}

// ── .rvt — project document selector ─────────────────────────────────────────────────────────────

export function RvtChip({ target }: { target: string }) {
  const [open, setOpen] = useState(false);
  const { session, busy, actionError, run } = useDocumentSession(target, open);

  const openProject = session.data?.openDocuments.find((doc) => !doc.isFamilyDocument);
  const activeDoc = session.data?.activeDocument;
  const projectTitle =
    activeDoc && !activeDoc.isFamilyDocument ? activeDoc.title : openProject?.title;

  const recents = useHostOp(
    "revit.catalog.recent-documents",
    { includeRegistryMru: true },
    { bridgeSessionId: target || undefined, enabled: Boolean(target) && open, staleTime: 60_000 },
  );
  const entries = recentByExtension(recents.data?.documents, ".rvt");

  return (
    <DocChip
      prefix=".rvt"
      label={projectTitle ?? "no project"}
      hasValue={projectTitle != null}
      disabled={!target}
      open={open}
      onToggle={() => setOpen((o) => !o)}
      onClose={() => setOpen(false)}
      title="project document — pick a recent .rvt to open"
    >
      <PanelHeader label="project document" detail={projectTitle ?? "none open"} />
      {actionError ? <PanelNote tone="error" text={actionError} /> : null}
      {recents.isPending ? <PanelNote text="loading recent documents…" /> : null}
      {recents.error ? <PanelNote tone="error" text={errorText(recents.error)} /> : null}
      {recents.data && entries.length === 0 ? <PanelNote text="no recent .rvt files" /> : null}
      <div className="max-h-72 overflow-y-auto">
        {entries.map((doc) => (
          <PanelRow
            key={doc.path}
            primary={doc.title}
            secondary={`R${doc.revitYear}`}
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  callHostRpc(
                    "revit.apply.document.open",
                    { path: doc.path },
                    { bridgeSessionId: target },
                  ),
                () => setOpen(false),
              )
            }
          />
        ))}
      </div>
    </DocChip>
  );
}

// ── .rfa — family combobox ───────────────────────────────────────────────────────────────────────

export function RfaChip({ target }: { target: string }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { session, busy, actionError, run } = useDocumentSession(target, open);

  const activeDoc = session.data?.activeDocument;
  const familyTitle = activeDoc?.isFamilyDocument ? activeDoc.title : undefined;
  const hasProject = session.data?.openDocuments.some((doc) => !doc.isFamilyDocument) ?? false;

  // project open → loaded families; no project → recent .rfa files
  const loaded = useHostOp(
    "revit.catalog.loaded-families",
    { projection: { view: "Handles" } },
    {
      bridgeSessionId: target || undefined,
      enabled: Boolean(target) && open && hasProject,
      staleTime: 60_000,
    },
  );
  const recents = useHostOp(
    "revit.catalog.recent-documents",
    { includeRegistryMru: true },
    {
      bridgeSessionId: target || undefined,
      enabled: Boolean(target) && open && !hasProject,
      staleTime: 60_000,
    },
  );

  const needle = search.trim().toLowerCase();
  const matches = (...texts: (string | null | undefined)[]) =>
    !needle || texts.some((text) => text?.toLowerCase().includes(needle));

  const families = (loaded.data?.families ?? []).filter(
    (family) =>
      !isBogusCategory(family.categoryName) && matches(family.familyName, family.categoryName),
  );
  const recentEntries = recentByExtension(recents.data?.documents, ".rfa").filter((doc) =>
    matches(doc.title),
  );

  const source = hasProject ? loaded : recents;

  return (
    <DocChip
      prefix=".rfa"
      label={familyTitle ?? "no family"}
      hasValue={familyTitle != null}
      disabled={!target}
      open={open}
      onToggle={() => setOpen((o) => !o)}
      onClose={() => setOpen(false)}
      title="family — search loaded families or recent .rfa files"
    >
      <PanelHeader
        label="family"
        detail={hasProject ? "loaded in project" : "recent .rfa files"}
      />
      <div className="px-3 py-1.5" style={{ borderBottom: "0.5px solid var(--line-soft)" }}>
        <input
          autoFocus
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={hasProject ? "filter by family or category…" : "filter recent families…"}
          className="w-full rounded-[2px] border border-[var(--line-2)] bg-transparent px-1.5 py-0.5 text-[11px] outline-none focus:border-[var(--pe-blue)]"
        />
      </div>
      {actionError ? <PanelNote tone="error" text={actionError} /> : null}
      {source.isPending ? <PanelNote text="loading…" /> : null}
      {source.error ? <PanelNote tone="error" text={errorText(source.error)} /> : null}
      <div className="max-h-72 overflow-y-auto">
        {hasProject
          ? families.map((family) => (
              <PanelRow
                key={family.familyId}
                primary={family.familyName}
                secondary={`${family.categoryName} · ${family.typeCount} type${family.typeCount === 1 ? "" : "s"}`}
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      callHostRpc(
                        "family.editor.open",
                        { familyId: family.familyId, familyName: family.familyName },
                        { bridgeSessionId: target },
                      ),
                    () => setOpen(false),
                  )
                }
              />
            ))
          : recentEntries.map((doc) => (
              <PanelRow
                key={doc.path}
                primary={doc.title}
                secondary={`R${doc.revitYear}`}
                disabled={busy}
                onClick={() =>
                  void run(
                    () =>
                      callHostRpc(
                        "revit.apply.document.open",
                        { path: doc.path },
                        { bridgeSessionId: target },
                      ),
                    () => setOpen(false),
                  )
                }
              />
            ))}
        {source.data && (hasProject ? families : recentEntries).length === 0 ? (
          <PanelNote text={needle ? "no matches" : "nothing to list"} />
        ) : null}
      </div>
    </DocChip>
  );
}
