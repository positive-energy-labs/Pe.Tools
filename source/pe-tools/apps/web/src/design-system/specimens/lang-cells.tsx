import { useState } from "react";

import { CellStateKey } from "#/components/lang/cell-key";
import { StateCell } from "#/components/lang/cell";
import { FactChip, NarrowChip, Tag } from "#/components/lang/chip";
import { Section } from "#/components/lang/section";
import { PARAM_ROWS, cellProps } from "#/design-system/fixtures";

const TONES = ["meta", "caution", "done", "alarm", "pea"] as const;

export function LangCellSpecimens() {
  const [visible, setVisible] = useState(true);
  return (
    <Section label="lang · cells and chips">
      <div className="flex flex-col gap-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {PARAM_ROWS.slice(0, 8).map((row) => (
            <StateCell key={row.key} {...cellProps(row)} />
          ))}
        </div>
        <CellStateKey />
        <div className="flex flex-wrap items-center gap-2">
          {TONES.map((tone) => (
            <FactChip key={tone} tone={tone} title={`tone=${tone}`}>
              {tone}
            </FactChip>
          ))}
          <Tag>door 421</Tag>
          {visible ? (
            <NarrowChip
              label="needs a person"
              count={3}
              title="Removing this widens the view."
              onRemove={() => setVisible(false)}
            />
          ) : null}
        </div>
      </div>
    </Section>
  );
}
