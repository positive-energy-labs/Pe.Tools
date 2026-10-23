import { LOSS_RULES, ruleByKey, ruleWords, type LossRule } from "@pe/ducts-domain/loss-rules";
import type { DuctSnapshot } from "@pe/ducts-domain/types";
import type { Split } from "../../loss-split";

type Node = DuctSnapshot["nodes"][number];
export type BarRow = ReturnType<typeof barRows>[number];

/** Assigning a rule can rename and regroup the same fittings. Keep their editor open. */
export function selectedBarRow<T extends { key: string; ids: readonly number[] }>(
  rows: readonly T[],
  selected: { key: string; ids: readonly number[] } | null,
) {
  return selected
    ? (rows.find((row) => row.key === selected.key) ??
        rows.find((row) => row.ids.some((id) => selected.ids.includes(id))))
    : undefined;
}

/** Read the run already priced for this bar, never scan every system on opening. */
export function barRows(split: Split, scale: number, nodes: ReadonlyMap<number, Node>) {
  let pos = 0;
  return split.groups.map((group) => {
    const ids = new Set(group.ids);
    const rows = split.rows.filter((row) => ids.has(row.id));
    const members = group.ids.flatMap((id) => nodes.get(id) ?? []);
    const families = [...new Set(members.flatMap((node) => (node.family ? [node.family] : [])))];
    const rules = [...new Set(rows.flatMap((row) => (row.rule ? [row.rule] : [])))].flatMap(
      (key) => ruleByKey(key) ?? [],
    );
    const tables = [...new Set(rows.flatMap((row) => (row.table ? [row.table] : [])))];
    const axes = new Map<string, Set<number>>();
    for (const { inputs } of rows) {
      if (!inputs) continue;
      const add = (label: string, value: number) => {
        const values = axes.get(label) ?? new Set<number>();
        values.add(Number(value.toFixed(3)));
        axes.set(label, values);
      };
      add(inputs.xLabel, inputs.x);
      if (inputs.yLabel && inputs.y != null) add(inputs.yLabel, inputs.y);
    }
    const inputs = [...axes].map(([label, values]) => `${label} = ${[...values].join(", ")}`);
    const at = group.dp > 0 ? [Math.min(1, pos + Math.min(1 - pos, group.dp / scale) / 2)] : [];
    pos += group.dp / scale;
    const candidates =
      group.element === "fitting"
        ? LOSS_RULES.filter(
            (rule) =>
              rules.some((current) =>
                current.options.some((table) => rule.options.includes(table)),
              ) ||
              (!rules.length &&
                members.some((node) =>
                  node.partType === "Elbow"
                    ? node.connectors.some((port) => port.shape === "round")
                      ? rule.key.startsWith("elbow-") && !rule.key.startsWith("elbow-mitered")
                      : rule.key.startsWith("elbow-mitered")
                    : node.partType === "Transition"
                      ? rule.key.startsWith("trx-")
                      : node.partType?.startsWith("Tap")
                        ? rule.key === "tap-std"
                        : node.kind === "accessory" && rule.key === "damper",
                )),
          )
        : [];
    return {
      ...group,
      at,
      count: ids.size,
      share: (group.dp / scale) * 100,
      members,
      families,
      rules,
      tables,
      words: rules.length
        ? rules
            .map((rule) => ruleWords({ ...rule, cond: "" }).replace(/\s*·\s*$/, ""))
            .filter((word, i, all) => all.indexOf(word) === i)
            .join("; ")
        : group.element === "duct"
          ? "Duct friction"
          : group.element === "fitting"
            ? "Stated drop / no matching rule"
            : "Catalog / stated drop",
      conditions: [
        ...rules.map((rule) => [rule.type, rule.cond].filter(Boolean).join(" · ")),
        ...inputs,
      ].filter(Boolean),
      candidates,
    };
  });
}

/** The assignment overrides automatic matching; make that bypass visible, including 0.75 D. */
export function ruleConditions(rule: LossRule, row: BarRow) {
  const ratio = rule.key === "elbow-075d" ? 0.75 : rule.key.startsWith("elbow-1d") ? 1 : null;
  const actual = row.members.map((node) => node.facts.find((f) => f.key === "rOverD")?.value);
  return {
    words: [rule.type, rule.cond].filter(Boolean).join(" · ") || "any size",
    inactive:
      ratio != null && actual.some((value) => value == null || Math.abs(value - ratio) >= 0.001),
    actual:
      ratio == null
        ? null
        : `r/D read: ${[...new Set(actual.map((value) => value ?? "unknown"))].join(", ")}`,
  };
}
