/**
 * PROTOTYPE — variant registry for the clean-room /family exploration.
 * Each variant is a self-contained page rendering the shared WORLD fixture.
 */
import { VariantA } from "#/family/proto/variant-a";
import { VariantB } from "#/family/proto/variant-b";
import { VariantC } from "#/family/proto/variant-c";
import { VariantD } from "#/family/proto/variant-d";
import { VariantE } from "#/family/proto/variant-e";
import { ProtoSwitcher, type VariantMeta } from "#/family/proto/switcher";

const VARIANTS: VariantMeta[] = [
  { key: "a", name: "Crossing — profile ⟷ live duality" },
  { key: "b", name: "Stagecraft — journey bar + stage-owned panes" },
  { key: "c", name: "Ledger — pipeline as table columns" },
  { key: "d", name: "Dossier — profile as document" },
  { key: "e", name: "Converged — round 2" },
];

export function FamilyProto({ variant }: { variant: string }) {
  return (
    <>
      {variant === "a" && <VariantA />}
      {variant === "b" && <VariantB />}
      {variant === "c" && <VariantC />}
      {variant === "d" && <VariantD />}
      {variant === "e" && <VariantE />}
      <ProtoSwitcher variants={VARIANTS} current={variant} />
    </>
  );
}
