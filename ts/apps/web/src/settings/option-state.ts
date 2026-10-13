import type { AppSurface } from "@pe/agent-contracts";
import type { ComponentType } from "react";
export type OptionScope = "user" | "machine" | "route" | "page" | "window";
export interface OptionBinding<T> {
  read: () => T;
  write: (value: T) => void;
  subscribe?: (listener: () => void) => () => void;
}
type OptionBase = {
  id: string;
  label: string;
  scope: OptionScope;
  description?: string;
  surfaces: readonly AppSurface[];
  projections: readonly ("quick" | "form")[];
};
export type SettingsOption = OptionBase &
  (
    | { kind: "boolean"; binding: OptionBinding<boolean> }
    | {
        kind: "choice";
        choices: readonly { value: string; label: string; title: string }[];
        binding: OptionBinding<string>;
      }
  );
/** Durable options bind an external owner, never a mounted Page or window instance. */
export type GlobalOption = SettingsOption & { scope: "user" | "machine" | "route" };
/** A custom form keeps its existing controller; the catalogue stores this component reference. */
export interface SettingsPanel {
  id: string;
  label: string;
  scope: "user" | "machine" | "route";
  surfaces: readonly AppSurface[];
  render: ComponentType;
}
export type PageOption<P> = OptionBase & { scope: "page" | "window" } & (
    | { kind: "boolean"; read: (page: P) => boolean; patch: (value: boolean) => Partial<P> }
    | {
        kind: "choice";
        choices: readonly { value: string; label: string; title: string }[];
        read: (page: P) => string;
        patch: (value: string) => Partial<P>;
      }
  );
export type OptionContribution = {
  owner: symbol;
  route: string;
  name: string;
  options: readonly SettingsOption[];
};

/** Stores live bindings, never a second copy of an owner's values. */
export function createPageOptions() {
  let current: OptionContribution | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    read: () => current,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    claim: (contribution: OptionContribution) => {
      current = contribution;
      notify();
    },
    release: (owner: symbol) => {
      if (current?.owner !== owner) return;
      current = null;
      notify();
    },
    write: (owner: symbol, invoke: () => void) => {
      if (current?.owner === owner) invoke();
    },
  };
}
export type PageOptions = ReturnType<typeof createPageOptions>;
