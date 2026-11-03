import type { RouteActivityScope } from "../route/activity";
import type { AdmittedAddressPort } from "./admitted-address";
import { freezePage } from "./page-port";

type Disposable = { dispose(): void };
export interface PlaceSubjectProjection {
  readonly label: string | null;
  readonly roster: readonly { readonly id: string; readonly label: string }[];
}

/** Application adapter, not a pane capability. The retained state owns the single Page and
 * accepted readings; only leases belong to Activity's disconnecting effects.
 * TODO: K3b composes this into the application shell/mount/pane after K1; tab/window
 * consumers subscribe to subject(), and accepted Page publications call remember(). */
export interface AdmittedPlace<State extends Disposable> extends Disposable {
  readonly address: AdmittedAddressPort;
  current(): boolean;
  visible(): boolean;
  setVisible(visible: boolean): void;
  state(create: () => State): State;
  memory(): unknown;
  remember(page: unknown): void;
  lease(resource: Disposable): () => void;
  subject(): PlaceSubjectProjection;
  publishSubject(subject: PlaceSubjectProjection): void;
  subscribe(listener: () => void): () => void;
}

export function createAdmittedPlace<State extends Disposable>(options: {
  readonly scope: RouteActivityScope;
  readonly address: AdmittedAddressPort;
  /** Codec text captured for this Place, including when constructed inactive. */
  readonly search: URLSearchParams;
  readonly memory?: unknown;
  readonly visible: boolean;
}): AdmittedPlace<State> {
  const { scope } = options;
  let disposed = false;
  let visible = options.visible;
  let state: State | undefined;
  let memory: unknown = freezePage(options.memory ?? {});
  let captured = new URLSearchParams(options.search);
  let subject: PlaceSubjectProjection = Object.freeze({ label: null, roster: Object.freeze([]) });
  const listeners = new Set<() => void>();
  const addressListeners = new Set<() => void>();
  const leases = new Set<Disposable>();
  const current = () => !disposed && visible && scope.current();
  const notify = () => listeners.forEach((listener) => listener());
  const release = (resource: Disposable) => {
    if (leases.delete(resource)) resource.dispose();
  };
  const unsubscribe = options.address.subscribe(() => {
    if (!current()) return;
    captured = new URLSearchParams(options.address.read());
    addressListeners.forEach((listener) => listener());
  });
  const place: AdmittedPlace<State> = {
    address: {
      read: () => new URLSearchParams(current() ? options.address.read() : captured),
      write(search, history) {
        if (!current()) return;
        captured = new URLSearchParams(search);
        options.address.write(new URLSearchParams(search), history);
      },
      subscribe(listener) {
        addressListeners.add(listener);
        return () => {
          addressListeners.delete(listener);
        };
      },
    },
    current,
    visible: () => !disposed && visible,
    setVisible(next) {
      if (disposed || next === visible) return;
      visible = next;
      if (!visible) for (const resource of leases) release(resource);
      // Reveal itself neither restores Page nor acquires expensive resources.
    },
    state(create) {
      if (disposed) throw Error("Place is disposed");
      return (state ??= create());
    },
    memory: () => memory,
    remember(page) {
      if (!disposed) memory = freezePage(page);
    },
    lease(resource) {
      if (!disposed && visible) leases.add(resource);
      else resource.dispose();
      return () => release(resource);
    },
    subject: () => subject,
    publishSubject(next) {
      if (disposed) return;
      subject = freezePage({ label: next.label, roster: next.roster.map((row) => ({ ...row })) });
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      for (const resource of leases) release(resource);
      state?.dispose();
      listeners.clear();
      addressListeners.clear();
    },
  };
  scope.retain(place);
  return place;
}
