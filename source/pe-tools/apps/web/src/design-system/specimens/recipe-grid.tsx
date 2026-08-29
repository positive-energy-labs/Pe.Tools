import type { ReactNode } from "react";

import { Tag } from "#/components/lang/chip";
import { Section } from "#/components/lang/section";
import type { RecipeMetadata } from "#/lib/tv";

export const IMPORT_COUNTS = {
  "#/components/lang/addressing-bar": 5,
  "#/components/lang/arming-strip": 3,
  "#/components/lang/artifact-frame": 10,
  "#/components/lang/cell": 10,
  "#/components/lang/cell-key": 1,
  "#/components/lang/chip": 41,
  "#/components/lang/coverage-bar": 2,
  "#/components/lang/empty": 39,
  "#/components/lang/help": 11,
  "#/components/lang/outcome": 24,
  "#/components/lang/press": 48,
  "#/components/lang/section": 14,
  "#/components/lang/switcher": 7,
  "#/components/lang/verb": 37,
  "#/components/ui/badge": 0,
  "#/components/ui/card": 1,
  "#/components/ui/combobox": 6,
  "#/components/ui/command": 1,
  "#/components/ui/dialog": 1,
  "#/components/ui/input": 5,
  "#/components/ui/input-group": 0,
  "#/components/ui/label": 2,
  "#/components/ui/pane": 10,
  "#/components/ui/pick-list": 2,
  "#/components/ui/select": 4,
  "#/components/ui/side-pane": 5,
  "#/components/ui/switch": 2,
  "#/components/ui/textarea": 3,
  "#/components/ui/toggle-group": 0,
  "#/components/ui/value-diff": 2,
} as const;

type ImportPath = keyof typeof IMPORT_COUNTS;
export type GridVariantProps = Record<string, string | boolean>;
type Axis = readonly [name: string, values: readonly string[]];

export function recipeVariantProps(recipe: RecipeMetadata): GridVariantProps[] {
  const axes = Object.entries(recipe.variants).map(
    ([axis, values]) => [axis, Object.keys(values)] as const,
  );
  if (axes.length === 0) return [{}];
  const groups: readonly (readonly Axis[])[] =
    axes.length <= 2 ? [axes] : [axes.slice(0, 2), ...axes.slice(2).map((axis) => [axis])];
  return groups.flatMap(variantPropsForAxes);
}

export function RecipeGrid({
  name,
  importPath,
  recipe,
  render,
}: {
  name: string;
  importPath: ImportPath;
  recipe: RecipeMetadata;
  render: (variantProps: GridVariantProps) => ReactNode;
}) {
  const axes = Object.entries(recipe.variants).map(
    ([axis, values]) => [axis, Object.keys(values)] as const,
  );
  const groups: readonly (readonly Axis[])[] =
    axes.length <= 2 ? [axes] : [axes.slice(0, 2), ...axes.slice(2).map((axis) => [axis])];

  return (
    <SpecimenFrame name={name} importPath={importPath}>
      {axes.length === 0 ? (
        <div className="grid gap-2">
          <span>{recipe.slots.length > 0 ? `slots · ${recipe.slots.join(" · ")}` : "base"}</span>
          <div data-recipe={name}>{render({})}</div>
        </div>
      ) : (
        groups.map((group) => (
          <VariantGrid
            key={group.map(([axis]) => axis).join("+")}
            recipe={name}
            axes={group}
            render={render}
          />
        ))
      )}
    </SpecimenFrame>
  );
}

export function SpecimenFrame({
  name,
  importPath,
  children,
}: {
  name: string;
  importPath: ImportPath;
  children: ReactNode;
}) {
  const count = IMPORT_COUNTS[importPath];
  return (
    <Section label={name} aside={<Tag>{`${count} static import${count === 1 ? "" : "s"}`}</Tag>}>
      <code>{importPath}</code>
      <div className="overflow-x-auto py-2">{children}</div>
    </Section>
  );
}

function VariantGrid({
  recipe,
  axes,
  render,
}: {
  recipe: string;
  axes: readonly Axis[];
  render: (variantProps: GridVariantProps) => ReactNode;
}) {
  const [rowAxis, columnAxis] = axes.length === 1 ? [undefined, axes[0]] : axes;
  if (!columnAxis) return null;
  const [columnName, columns] = columnAxis;
  const rows = rowAxis ? rowAxis[1] : [undefined];
  const specimens = variantPropsForAxes(axes);

  return (
    <div
      className="grid min-w-max gap-x-3 gap-y-2 py-2"
      style={{
        gridTemplateColumns: `minmax(7rem,auto) repeat(${columns.length}, minmax(8rem,1fr))`,
      }}
      data-recipe={recipe}
      data-axes={axes.map(([axis]) => axis).join("+")}
    >
      <span>{rowAxis ? `${rowAxis[0]} × ${columnName}` : columnName}</span>
      {columns.map((column) => (
        <span key={column}>{`${columnName}=${column}`}</span>
      ))}
      {rows.flatMap((row, rowIndex) => {
        const rowProps = rowAxis && row ? { [rowAxis[0]]: variantValue(row) } : {};
        return [
          <span key={`${row ?? "specimen"}-head`}>
            {rowAxis && row ? `${rowAxis[0]}=${row}` : "specimen"}
          </span>,
          ...columns.map((column, columnIndex) => {
            const props = specimens[rowIndex * columns.length + columnIndex] ?? {
              ...rowProps,
              [columnName]: variantValue(column),
            };
            return (
              <div key={`${row ?? "specimen"}-${column}`} data-variant={JSON.stringify(props)}>
                {render(props)}
              </div>
            );
          }),
        ];
      })}
    </div>
  );
}

function variantValue(value: string): string | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function variantPropsForAxes(axes: readonly Axis[]): GridVariantProps[] {
  const [rowAxis, columnAxis] = axes.length === 1 ? [undefined, axes[0]] : axes;
  if (!columnAxis) return [{}];
  const rows = rowAxis ? rowAxis[1] : [undefined];
  return rows.flatMap((row) =>
    columnAxis[1].map((column) => ({
      ...(rowAxis && row ? { [rowAxis[0]]: variantValue(row) } : {}),
      [columnAxis[0]]: variantValue(column),
    })),
  );
}
