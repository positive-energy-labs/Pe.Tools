import { useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { PopupFrame } from "#/components/lang/list-popup";
import { Press } from "#/components/lang/press";
import type { FamilyParameterSnapshot } from "#/host/loaded-families-view";
import type { PivotRow } from "./pivot";
import type { OverlayParameter } from "./patch-overlay";
import { ValueDiff } from "#/components/lang/value-diff";

export type ParameterMetadataRecord = { family: string; parameter: FamilyParameterSnapshot };

function MetadataControl({
  name,
  proposed = false,
  children,
}: {
  name: string;
  proposed?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        render={<Press size="caption" tone={proposed ? "agent" : "quiet"} />}
        aria-label={`Metadata for ${name}`}
      >
        {proposed ? "metadata · proposed" : "metadata"}
      </Popover.Trigger>
      <PopupFrame label={`Metadata for ${name}`}>
        <div className="max-h-96 w-96 max-w-full overflow-auto p-3 t-small">
          <Popover.Title className="face-mono mb-2 font-bold">{name}</Popover.Title>
          {children}
        </div>
      </PopupFrame>
    </Popover.Root>
  );
}

const said = (value: unknown) =>
  value == null ? null : typeof value === "string" ? value : JSON.stringify(value);
const binding = (instance: boolean | null | undefined) =>
  instance == null ? null : instance ? "instance" : "type";

/** The snapshot field each patch field changes (FamilyModelParameter ↔ the reading). */
type Read = (p: FamilyParameterSnapshot) => unknown;
/** Label, patch field, the reading's shown word, and its id when the patch speaks in ids. */
const FIELDS: readonly [string, string | null, Read, Read?][] = [
  ["scope", null, (p) => p.scope],
  ["binding", "isInstance", (p) => binding(p.definition.isInstance)],
  [
    "spec",
    "dataType",
    (p) => p.definition.dataTypeLabel ?? p.definition.dataTypeId,
    (p) => p.definition.dataTypeId,
  ],
  [
    "group",
    "propertiesGroup",
    (p) => p.definition.groupTypeLabel ?? p.definition.groupTypeId,
    (p) => p.definition.groupTypeId,
  ],
  ["formula", "formula", (p) => p.formula ?? p.formulaState],
  ["visible", "sharedVisible", (p) => p.definition.visible],
  ["user modifiable", "sharedUserModifiable", (p) => p.definition.userModifiable],
  ["description", "tooltip", (p) => p.definition.description],
  ["identity", "sharedGuid", (p) => p.definition.identity.sharedGuid ?? p.definition.identity.key],
];
const MAPPED = new Set(FIELDS.flatMap(([, key]) => (key ? [key] : [])));

function Diff({
  rows,
}: {
  rows: readonly { label: string; from: string | null; to: string | null }[];
}) {
  return (
    <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-2 py-2">
      {rows.map(({ label, from, to }) => (
        <div key={label} className="contents">
          <dt className="text-ink-2">{label}</dt>
          <dd className="break-words" data-tone={to != null && to !== from ? "pea" : undefined}>
            <ValueDiff from={from} to={to ?? from ?? "not reported"} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** The reading's metadata per family; a field the native patch changes reads as a `ValueDiff`. */
export function ParameterMetadata({
  row,
  records,
  patch,
}: {
  row: PivotRow;
  records: readonly ParameterMetadataRecord[];
  patch?: OverlayParameter;
}) {
  const rung = patch?.staged ? "staged" : "proposed";
  const fields: Record<string, unknown> = patch?.staged ?? patch?.proposal ?? {};
  const to = (key: string | null) =>
    key === null
      ? null
      : key === "isInstance"
        ? binding(fields[key] as boolean)
        : said(fields[key]);
  const extra = Object.keys(fields)
    .filter((key) => !MAPPED.has(key))
    .map((key) => ({ label: key, from: null, to: said(fields[key]) }));
  const diffs = records.map(({ family, parameter: p }) => ({
    family,
    rows: [
      ...FIELDS.map(([label, key, read, id]) => {
        // A family the patch does not select keeps its reading.
        const value = patch?.families.includes(family) ? to(key) : null;
        // A patch naming the id the reading already has changes nothing: keep the reading's word.
        return { label, from: said(read(p)), to: id && value === said(id(p)) ? null : value };
      }),
      ...(patch?.families.includes(family) ? extra : []),
    ],
  }));
  const changed =
    patch != null &&
    (records.length === 0 ||
      extra.length > 0 ||
      diffs.some((diff) => diff.rows.some((r) => r.to != null && r.to !== r.from)));
  return (
    <MetadataControl name={row.name} proposed={changed}>
      <p>
        {row.kind} · {row.families} families · {row.filled}/{row.present} filled
      </p>
      {changed && (
        <p className="text-ink-2" data-tone="pea">
          the native patch ({rung}) changes this parameter; review it on the patch row
        </p>
      )}
      {patch && records.length === 0 && (
        <Diff
          rows={[
            ...FIELDS.flatMap(([label, key]) => {
              const value = to(key);
              return value == null ? [] : [{ label, from: null, to: value }];
            }),
            ...extra,
          ]}
        />
      )}
      {diffs.map(({ family, rows }) => (
        <details key={family} open={records.length === 1} className="border-t mt-2 pt-2">
          <summary className="cursor-pointer">{family}</summary>
          <Diff rows={rows} />
        </details>
      ))}
    </MetadataControl>
  );
}
