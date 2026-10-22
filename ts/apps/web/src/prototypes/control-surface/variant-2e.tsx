/** THROWAWAY protoui 2e: the web app bar order (Back, Forward, Home, Open Pea, route field, commands, seam, Settings, window controls); Routes is the palette first section. */
import type { VariantMeta } from "./lineup";
import { TrayRoutes } from "./variant-2d.shared";

export const meta: VariantMeta = { id: "2e", label: "Route field only", width: 760, height: 560 };
export default function Variant() {
  return <TrayRoutes mode="appbar" />;
}
