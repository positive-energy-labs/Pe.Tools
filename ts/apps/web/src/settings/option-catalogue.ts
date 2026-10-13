import { appRouteByKey } from "@pe/agent-contracts";
import type { GlobalOption, SettingsPanel } from "./option-state";

export type GlobalOptionSection = {
  route: string;
  name: string;
  options: readonly GlobalOption[];
  panels: readonly SettingsPanel[];
};
let sections: readonly GlobalOptionSection[] = [];
const listeners = new Set<() => void>();
export const readGlobalOptions = () => sections;
export const subscribeGlobalOptions = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Route modules publish descriptors on import. Values stay in each binding's external owner. */
export function registerGlobalOptions(
  route: string,
  name: string,
  options: readonly GlobalOption[],
  panels: readonly SettingsPanel[] = [],
) {
  const key = appRouteByKey(route)?.key ?? route;
  const prior = sections.find((section) => section.route === key);
  if (
    prior?.name === name &&
    prior.options.length === options.length &&
    prior.options.every((option, index) => option === options[index]) &&
    prior.panels.length === panels.length &&
    prior.panels.every((panel, index) => panel === panels[index])
  )
    return;
  if (!prior && options.length === 0 && panels.length === 0) return;
  sections = [
    ...sections.filter((section) => section.route !== key),
    ...(options.length || panels.length ? [{ route: key, name, options, panels }] : []),
  ];
  listeners.forEach((listener) => listener());
}

export const settingsPanelDestination = (route: string, panel: string) =>
  `/settings?subject=${encodeURIComponent(route)}&section=${encodeURIComponent(panel)}`;
