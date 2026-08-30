import { Provenance, Section } from "#/components/lang/section";

import { ColourLaws } from "./laws-colour";
import { HonestyLaws } from "./laws-honesty";
import { StructureLaws } from "./laws-structure";
import { TypeLaws } from "./laws-type";

type LawPointers = readonly (readonly [string, string])[];

export function LawSpecimens({ pointers }: { pointers: LawPointers }) {
  const owner = (name: string) => pointers.find(([law]) => law === name)?.[1] ?? "unowned";
  return (
    <Section label={`01 / ${pointers.length} laws`}>
      <h3 className="pt-2 t-head text-ink">The laws</h3>
      <Provenance>
        Each ruling has one code home. The specimen is production code, not a drawing made for this
        page. The struck specimen shows the tempting misuse.
      </Provenance>
      <div className="flex flex-col gap-4 pt-5">
        <ColourLaws owner={owner} />
        <TypeLaws owner={owner} />
        <StructureLaws owner={owner} />
        <HonestyLaws owner={owner} />
      </div>
    </Section>
  );
}
