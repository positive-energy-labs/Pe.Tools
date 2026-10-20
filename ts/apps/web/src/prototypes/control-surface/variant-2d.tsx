/** THROWAWAY protoui 2d: tray routes in the app bar (Back/Forward, Home, one button per route, route field). */
import type { VariantMeta } from "./lineup";
import { TrayRoutes } from "./variant-2d.shared";

export const meta: VariantMeta = {
  id: "2d",
  label: "Tray routes in the app bar",
  width: 760,
  height: 560,
};
export default function Variant() {
  return <TrayRoutes mode="buttons" />;
}
