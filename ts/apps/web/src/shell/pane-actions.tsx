import { createContext, useContext, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/** A pane body's own header actions (a picture's go-to and encoding), drawn in the admitted pane
 * header the chrome owns. Leaf module: route bodies import it without importing the chrome. */
const Slot = createContext<HTMLElement | null>(null);
export function PaneActions({ children }: { children: ReactNode }) {
  const slot = useContext(Slot);
  return slot ? createPortal(children, slot) : null;
}
/** The chrome's side: `slot` goes in the header actions, `provide` wraps the body. */
export function PaneActionsSlot({
  children,
}: {
  children: (slot: ReactNode, provide: (body: ReactNode) => ReactNode) => ReactNode;
}) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  return children(<span ref={setNode} className="contents" />, (body) => (
    <Slot.Provider value={node}>{body}</Slot.Provider>
  ));
}
