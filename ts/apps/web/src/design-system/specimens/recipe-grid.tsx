import type { ReactNode } from "react";

import { Section } from "#/components/lang/section";
import type { RecipeMetadata } from "#/lib/tv";

type ImportPath = `#/components/${"lang" | "ui"}/${string}`;
export type GridVariantProps = Record<string, string | boolean>;
type Axis = readonly [name: string, values: readonly string[]];

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
          <span className="t-small face-mono text-ink-mute">
            {recipe.slots.length > 0 ? `slots · ${recipe.slots.join(" · ")}` : "base"}
          </span>
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
  return (
    <Section label={name}>
      <code className="t-small face-mono text-ink-mute">{importPath}</code>
      <div className="overflow-x-auto py-2 t-small face-mono text-ink">{children}</div>
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
      <span className="t-small face-mono text-ink-mute">
        {rowAxis ? `${rowAxis[0]} × ${columnName}` : columnName}
      </span>
      {columns.map((column) => (
        <span className="t-small face-mono text-ink-2" key={column}>
          {`${columnName}=${column}`}
        </span>
      ))}
      {rows.flatMap((row, rowIndex) => {
        const rowProps = rowAxis && row ? { [rowAxis[0]]: variantValue(row) } : {};
        return [
          <span className="t-small face-mono text-ink-2" key={`${row ?? "specimen"}-head`}>
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
