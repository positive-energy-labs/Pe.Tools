import { Provenance, Section } from "#/components/lang/section";

import { CatalogueActions } from "./catalogue-actions";
import { CatalogueCells } from "./catalogue-cells";
import { CatalogueWorkflow } from "./catalogue-workflow";

export function CatalogueSpecimens() {
  return (
    <Section label="03 · catalogue">
      <h3 className="pt-2 t-head text-ink">The catalogue</h3>
      <Provenance>
        These are the states that change a product decision. The swatch owns every mechanical
        variant and every import path.
      </Provenance>
      <div className="flex flex-col gap-5 pt-5">
        <CatalogueActions />
        <CatalogueCells />
        <CatalogueWorkflow />
      </div>
    </Section>
  );
}
