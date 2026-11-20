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
