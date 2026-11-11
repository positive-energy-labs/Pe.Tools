import type { Address, DocumentRef, ExecutionTarget } from "@pe/agent-contracts";
import { fixtureName } from "./fixture-name";
import type { RouteActivityScope } from "../route/activity";
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
