import { createContext, useContext } from "react";

/** Show a pane of the enclosing layout (`GraphLayoutView` provides it). Leaf module: route bodies
 * reveal a pane without importing the layout. Outside a layout it does nothing. */
export const PaneReveal = createContext<(pane: string) => void>(() => {});
export const useRevealPane = () => useContext(PaneReveal);
