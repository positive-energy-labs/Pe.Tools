import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type Register = (key: object, label: string) => () => void;
/** Context preserves ownership across arbitrary portals, which DOM ancestry cannot do. */
export const WorkContext = createContext<Register | null>(null);

/**
 * Work registers with the nearest owner: a pane, else the route surface, else the app root. The
 * app mounts a root owner, so nothing drops there; a bare render (a test, a specimen) has none.
 * Owners draw the busy motif themselves, so a call site only says what is pending.
 */
export function useWork(pending?: boolean, label = "reading…") {
  const register = useContext(WorkContext);
  const key = useRef({});
  useEffect(
    () => (pending ? register?.(key.current, label) : undefined),
    [pending, label, register],
  );
}

/** Work owned by a component that renders no hook of its own (a Suspense fallback, a switch). */
export function Work({ pending = true, label }: { pending?: boolean; label?: string }) {
  useWork(pending, label);
  return null;
}

/** An owner's registry: the distinct labels of its live work, newest last. */
export function useWorkOwner() {
  const [registered, setRegistered] = useState(() => new Map<object, string>());
  const register = useCallback<Register>((key, label) => {
    setRegistered((old) => new Map(old).set(key, label));
    return () =>
      setRegistered((old) => {
        const next = new Map(old);
        next.delete(key);
        return next;
      });
  }, []);
  return { register, labels: [...new Set(registered.values())] };
}

/** The owner's root element carries the motif: `data-working` sweeps its top edge (lang.css), and
 *  `data-work` names what it waits on, so an inspector (or an agent) can read the cause. */
export const workAttributes = (owner: string, labels: readonly string[]) => ({
  "data-work-owner": owner,
  "data-working": labels.length > 0 || undefined,
  "data-work": labels.length ? labels.join(" · ") : undefined,
  "aria-busy": labels.length > 0 || undefined,
});

/** A surface or app-root owner: one element, no chip; the root draws a page-loading bar. */
export function WorkOwner({
  owner,
  className,
  children,
}: {
  owner: "surface" | "root";
  className?: string;
  children: ReactNode;
}) {
  const { register, labels } = useWorkOwner();
  return (
    <WorkContext value={register}>
      <div {...workAttributes(owner, labels)} className={className}>
        {children}
      </div>
    </WorkContext>
  );
}
