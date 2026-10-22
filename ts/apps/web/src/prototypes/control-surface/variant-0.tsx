// THROWAWAY baseline: today's tray body on the patch-bay seed, in the lineup's light.
import { SettingsBody } from "#/machine/body";
import { MACHINE_SEEDS } from "#/open/seeds";

import type { VariantMeta } from "./lineup";

export const meta: VariantMeta = { id: "0", label: "Today (baseline)", width: 380, height: 640 };

export default function Variant() {
  return <SettingsBody reading={MACHINE_SEEDS["patch-bay"]} fixture shell="tray" />;
}
