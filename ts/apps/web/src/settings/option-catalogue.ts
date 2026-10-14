import { appRouteByKey } from "@pe/agent-contracts";
import type { GlobalOption } from "./option-state";

type GlobalOptionSection = {
  route: string;
  name: string;
  options: readonly GlobalOption[];
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
) {
  const key = appRouteByKey(route)?.key ?? route;
  const prior = sections.find((section) => section.route === key);
  if (
    prior?.name === name &&
    prior.options.length === options.length &&
    prior.options.every((option, index) => option === options[index])
  )
    return;
  if (!prior && options.length === 0) return;
  sections = [
    ...sections.filter((section) => section.route !== key),
    ...(options.length ? [{ route: key, name, options }] : []),
  ];
  listeners.forEach((listener) => listener());
}
