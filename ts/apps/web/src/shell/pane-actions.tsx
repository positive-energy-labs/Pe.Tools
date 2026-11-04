import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** A pane body's own header actions (a picture's go-to and encoding), drawn in its admitted pane
 * header. Leaf module: route bodies import it without importing the chrome. */
type Slots = { nodes: Readonly<Record<string, HTMLElement>>; slot: (pane: string) => ReactNode };
const Context = createContext<Slots | null>(null);
export function PaneActions({ pane, children }: { pane: string; children: ReactNode }) {
  const node = useContext(Context)?.nodes[pane];
  return node ? createPortal(children, node) : null;
}
/** The chrome's side: one provider per admitted route; `slot(pane)` goes in that pane's header. */
export function PaneActionSlots({ children }: { children: ReactNode }) {
  const [nodes, setNodes] = useState<Record<string, HTMLElement>>({});
  const slot = (pane: string) => (
    <span
      className="contents"
      ref={(node) => {
        if (node) setNodes((all) => (all[pane] === node ? all : { ...all, [pane]: node }));
      }}
    />
  );
  return <Context.Provider value={{ nodes, slot }}>{children}</Context.Provider>;
}
export const usePaneActionSlot = () => useContext(Context)?.slot ?? (() => null);
