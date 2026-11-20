import type { Address, DocumentRef, ExecutionTarget } from "@pe/agent-contracts";
import { fixtureName } from "@pe/web-kernel/shell/fixture-name";
import type { RouteActivityScope } from "@pe/web-kernel/route/activity";
import type { AdmittedAddressPort } from "./typed-address";
import { freezePage } from "./freeze-page";

export type PlaceInput = Readonly<{
  address: AdmittedAddressPort;
  fixture: string | null;
  target: ExecutionTarget | null;
  work: Readonly<{ address: Address | null; open: DocumentRef | null }>;
  custody: Readonly<{ current(): boolean }>;
  memory(this: void): unknown;
  history?: import("./history.ts").HistorySnapshot;
  readOnly?: boolean;
  publicationInstance?: string;
}>;

type Disposable = { dispose(): void };
export interface AdmittedPlace<State extends Disposable> extends Disposable {
  readonly address: AdmittedAddressPort;
  readonly fixture: string | null;
  current(): boolean;
  visible(): boolean;
  setVisible(visible: boolean): void;
  state(create: () => State): State;
  memory(this: void): unknown;
  remember(page: unknown): void;
  /**
   * The resolved target owns the Page (route-target.ts `targetOwner`). False means the Page this
   * Place holds was another target's and could not be dropped yet: the caller must not mount.
   */
  enter(owner: string | null, fields: readonly string[]): boolean;
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
  let owner: string | null = null;
  const addressListeners = new Set<() => void>();
  const current = () => !disposed && visible && scope.current();
  const unsubscribe = options.address.subscribe(() => {
    if (!current()) return;
    captured = new URLSearchParams(options.address.read());
    addressListeners.forEach((listener) => listener());
  });
  const place: AdmittedPlace<State> = {
    fixture: fixtureName(Object.fromEntries(options.search)),
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
    enter(next, fields) {
      if (next === null || next === owner) return true;
      // The first target adopts the address as given: a link or a reload names its own Page.
      if (owner !== null) {
        // ponytail: a hidden Place cannot write its address, so it waits unmounted for its reveal.
        if (!current()) return false;
        // The old target's mount goes first, so it can neither follow nor remember the reset.
        state?.dispose();
        state = undefined;
        const search = place.address.read();
        for (const field of fields) search.delete(field);
        memory = freezePage({});
        place.address.write(search, "replace");
      }
      owner = next;
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      state?.dispose();
      addressListeners.clear();
    },
  };
  scope.retain(place);
  return place;
}
