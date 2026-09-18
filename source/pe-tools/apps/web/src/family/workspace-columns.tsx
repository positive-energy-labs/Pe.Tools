import { useMemo } from "react";
import { ActionButton } from "#/components/lang/action-button";
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "#/components/lang/combobox";
import { ReadCell, StateDot, VERDICT_INK, VerdictCell } from "#/components/master-table/cells";
import type { Column, MasterTableState, Verdict } from "#/components/master-table/model";
import {
  AGREEMENT_TONE,
  MARK,
  MARK_TITLE,
  agreementOf,
  bindingOf,
  paramNameFor,
  pinnedSort,
  rowAgreement,
  sortDirOf,
  type PRow,
} from "#/family/model";
import type { FamilyWorkspaceCore } from "#/family/workspace-core";
import { useFamilyIdentityColumns } from "#/family/workspace-identity-columns";
import { useFamilyTypeColumn } from "#/family/workspace-type-column";

export function useFamilyColumns(core: FamilyWorkspaceCore) {
  const {
    world,
    draft,
    overlay,
    saved,
    tableState,
    drillState,
    drillType,
    stageType,
    binding,
    setBinding,
    rows,
    consumers,
    bindTo,
    bindToNew,
  } = core;
  const { railColumn, identityColumn } = useFamilyIdentityColumns(core);
  const typeColumn = useFamilyTypeColumn(core);
  const rowVerdict = (row: PRow): Verdict => {
    if (row.kind === "ghost")
      return {
        word: "unbound",
        tone: "caution",
        note: `UNBOUND — ${row.name} is a bindable dimension with no parameter driving it. It is not drift and it is not disagreement: both sides carry the same number. It is UNREACHABILITY, and the only verb that answers it is bind.`,
      };
    const state = rowAgreement(world, draft, row);
    return {
      word: state,
      tone: AGREEMENT_TONE[state],
      dim: state === "agree" || state === "unread",
      note: MARK_TITLE[state],
    };
  };
  const stateCol = (state: MasterTableState): Column<PRow> => ({
    key: "state",
    label: "state",
    title:
      "The row's worst verdict across all three types — what this parameter is most asking of you. Filter it to work one kind of trouble at a time. A ghost row's state is `unbound`, which is filterable like any other: that is how you ask the table for every number in this family that nothing can reach.",
    group: "",
    width: "w-36",
    facet: (row) => rowVerdict(row).word,
    // The state column SURVIVES the live column's death, and is careful about why. It carries no
    // live VALUE — it carries the row's worst agreement, which is a diff and not a reading, and
    // it is the only thing on the page you can filter by ("show me only drift", "show me only
    // unbound"). A facet is a use a cell state cannot serve.
    sort: (row) =>
      pinnedSort(
        row,
        row.kind === "ghost" ? "unbound" : rowAgreement(world, draft, row),
        sortDirOf(state, "state"),
      ),
    // A ghost's state cell carries its ONE crossing. Every other row's verbs live in the doc
    // sidebar or the drill-in, because they are decisions between two substrates; binding is
    // not — there is nothing to weigh, so it belongs on the row it changes.
    cell: (row) =>
      row.kind === "ghost" ? ghostStateCell(row) : <VerdictCell verdict={rowVerdict(row)} />,
  });

  /**
   * The bind picker — a plain render FUNCTION, not a component, and deliberately so: a component
   * declared inside the page gets a fresh identity every render, which remounts the open `select`
   * under the pointer. It is also INLINE rather than a popover, because a popover inside a
   * scrolling table has to be positioned against a moving viewport, and the row is already exactly
   * as wide as the choice needs. Cancel is the first option, so the picker can always be left.
   *
   * The same function serves the table and the constituent inspector, so the verb is literally the
   * same verb in both places rather than two that look alike.
   */
  const bindPicker = (
    slug: string,
    property: string,
    dataType: string,
    className?: string,
  ): React.ReactNode => {
    const literal = bindingOf(world, draft, slug, property);
    const open = binding?.slug === slug && binding.property === property;
    const newName = paramNameFor(slug, property);
    const candidates = [...world.paramRows, ...draft.newParams].filter(
      (param) => param.dataType === dataType,
    );
    const options = [
      { value: "#new", label: `＋ new parameter "${newName}", seeded ${literal}` },
      ...candidates.map((param) => ({
        value: param.name,
        label: `${param.name} — inherits ${draft.authored[param.name] ?? "nothing"}${
          (draft.authored[param.name] ?? "") === literal
            ? " (same as now)"
            : `, discards ${literal}`
        }`,
      })),
    ];

    if (open)
      return (
        <Combobox
          items={options}
          defaultOpen
          value={null}
          onOpenChange={(next) => !next && setBinding(null)}
          onValueChange={(option: (typeof options)[number] | null) => {
            if (option?.value === "#new") bindToNew(slug, property, dataType);
            else if (option) bindTo(slug, property, option.value);
          }}
          itemToStringLabel={(option: (typeof options)[number]) => option.label}
        >
          <span className={className}>
            <ComboboxInput
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              aria-label={`bind ${slug}.${property}`}
              placeholder="bind to… (Esc cancels)"
              title={`Give ${slug}.${property} a parameter — an existing one discards the ${literal} literal, a new one keeps ${literal} as its family value.`}
            />
          </span>
          <ComboboxContent>
            <ComboboxList>
              {(option: (typeof options)[number]) => (
                <ComboboxItem key={option.value} value={option}>
                  {option.label}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
      );

    return (
      <span className={className}>
        <ActionButton
          label="bind…"
          onClick={() => setBinding({ slug, property })}
          reason={`Bind ${slug}.${property} to a parameter — its one crossing, and the only verb that changes what CAN be said about this number. Offers every ${dataType} parameter already in the profile, or a new one named "${newName}" seeded with ${literal}. The ghost row then disappears into the parameter row that now represents it. Nothing leaves the page.`}
        />
      </span>
    );
  };

  const ghostStateCell = (row: PRow): React.ReactNode => {
    const slug = row.slug ?? "";
    const property = row.property ?? "";
    const literal = bindingOf(world, draft, slug, property);
    if (binding?.slug === slug && binding.property === property)
      return (
        <span className="flex h-(--item-h) items-center px-(--item-pad-x)">
          {bindPicker(slug, property, row.dataType)}
        </span>
      );
    return (
      <span className="flex h-(--item-h) items-center gap-1 px-(--item-pad-x)">
        <StateDot tone="caution" />
        <span
          title={`UNBOUND — ${literal} is frozen into the geometry of ${slug}. Nothing in the profile, no type, and no schedule can reach it.`}
        >
          unbound
        </span>
        {bindPicker(slug, property, row.dataType, "ml-auto")}
      </span>
    );
  };

  /**
   * PARAMETER × TYPE, and nothing else.
   *
   * The LIVE column is gone. It was three readings folded into one 52px cell because they had no
   * honest home — and now they have one: the three cells they are readings OF, under the ⇄ live
   * overlay. What survives of it is the agreement FACET on the state column, which is a diff
   * rather than a value, and which the cell overlay genuinely cannot serve: you cannot filter a
   * table by a colour.
   */
  const columns = useMemo<Column<PRow>[]>(() => {
    const list: Column<PRow>[] = [railColumn(), identityColumn(tableState), stateCol(tableState)];
    for (const typeName of world.typeNames) list.push(typeColumn(typeName, { header: true }));
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, draft, saved, overlay, stageType, binding, consumers, tableState]);

  // ponytail: family still derives order in the component; G7 cutover owed
  const firstGhostKey = useMemo(() => {
    const byKey = new Map(columns.map((column) => [column.key, column]));
    const query = tableState.query.trim().toLowerCase();
    return (
      [...rows]
        .filter(
          (row) =>
            (!query ||
              columns.some((column) => column.search?.(row).toLowerCase().includes(query))) &&
            Object.entries(tableState.filters).every(([key, value]) => {
              const column = byKey.get(key);
              return column?.match?.(row, value) ?? column?.facet?.(row) === value;
            }),
        )
        .sort((left, right) => {
          for (const sort of tableState.sorts) {
            const read = byKey.get(sort.key)?.sort;
            if (!read) continue;
            const before = read(left);
            const after = read(right);
            const order =
              typeof before === "number" && typeof after === "number"
                ? before - after
                : String(before).localeCompare(String(after));
            if (order !== 0) return sort.dir === "desc" ? -order : order;
          }
          return 0;
        })
        .find((row) => row.kind === "ghost")?.key ?? null
    );
  }, [columns, rows, tableState]);

  /**
   * THE DRILL-IN, on the same primitive. Same MasterTable, same identity cell, same editable type
   * cell — narrowed to one type and opened up with the spine. The crossing verbs live ONLY in the
   * pane header (capture <type> / apply <type>): a per-row verb column was tried and retired —
   * the arrows read as claims about direction the cells already carry, and a bulk decision made
   * row-by-row is the surface inventing work. The profile column right-aligns and the live column
   * left-aligns so the two numbers MEET at the spine and every row reads as one diff.
   */
  const drillColumns = useMemo<Column<PRow>[]>(() => {
    if (!drillType) return [];
    const typeName = drillType;
    return [
      railColumn(),
      identityColumn(drillState),
      typeColumn(typeName, { align: "right" }),
      {
        key: "spine",
        label: "spine",
        group: "SPINE",
        width: "w-16",
        facet: (row) => agreementOf(world, draft, row, typeName),
        all: "any agreement",
        title:
          "The seam. Every verb on this page is a crossing between the two sides, so the verdict is read here rather than hunted for in either column.",
        cell: (row) => {
          const state = agreementOf(world, draft, row, typeName);
          return (
            <span
              className="px-(--item-pad-x)"
              style={{ color: VERDICT_INK[AGREEMENT_TONE[state]] }}
              title={MARK_TITLE[state]}
            >
              {MARK[state]}
            </span>
          );
        },
      },
      {
        key: "live",
        label: "revit",
        group: "world.live",
        width: "w-28",
        title: `What Revit carries for the ${typeName} type right now. The profile's number right-aligns and this one left-aligns, so the two meet at the spine and each row reads as ONE diff. Reconciling them is the pane header's job — capture pulls Revit's numbers into the profile, apply writes the profile's numbers into Revit.`,
        cell: (row) => {
          if (world.missingInRevit.has(row.name))
            return <ReadCell value="missing" reason={MARK_TITLE["only-profile"]} />;
          const entry = draft.live[row.name]?.[typeName];
          const state = agreementOf(world, draft, row, typeName);
          return (
            <ReadCell
              value={entry?.value ?? "—"}
              reason={
                entry
                  ? `${typeName} — ${entry.value}. ${MARK_TITLE[state]}`
                  : MARK_TITLE[world.missingInRevit.has(row.name) ? "only-profile" : "unread"]
              }
            />
          );
        },
      },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world, draft, saved, overlay, drillType, stageType, binding, consumers, drillState]);

  // ── the anatomy pane ──────────────────────────────────────────────────────────────────────────

  return {
    railColumn,
    identityColumn,
    typeColumn,
    rowVerdict,
    stateCol,
    bindPicker,
    ghostStateCell,
    columns,
    firstGhostKey,
    drillColumns,
  };
}
