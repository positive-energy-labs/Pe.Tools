import { useContext, useEffect, useState } from "react";
import { Button } from "@pe/kit/lang/button";
import type { Pointer } from "../../../../packages/agent-contracts/src/pointers.ts";
import { WorkbenchContext } from "#/workbench/provider/thread-summary";
import { callOp } from "./readings-api";

/** ponytail: polled, ceiling one host read per 2 s per open route; upgrade to a host feed if lists grow. */
const POLL_MS = 2000;

/**
 * "Pea is pointing at" (ADR 0030 rule 10): this thread's pointers on this route, until dismissed.
 * Reads and dismisses through the same host-local ops Pea calls; it never writes the page's
 * selection, attention fields, URL or camera.
 */
export function PointerList({ route }: { route: string }) {
  const thread = useContext(WorkbenchContext)?.currentThreadId ?? "";
  const [pointers, setPointers] = useState<readonly Pointer[]>([]);
  useEffect(() => {
    if (!thread) return setPointers([]);
    const control = new AbortController();
    const read = () =>
      void callOp({ signal: control.signal }, "pointers.list", { thread }).then(
        (list) => setPointers(list.pointers),
        () => {},
      );
    read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      control.abort();
      clearInterval(timer);
    };
  }, [thread]);
  const here = pointers.filter((pointer) => pointer.route === route);
  if (!here.length) return null;
  return (
    <ul aria-label="Pea is pointing at" data-slot="pointers" className="m-0 flex list-none gap-2 p-0">
      {here.map((pointer) => (
        <li key={pointer.id} data-pointer={pointer.id} className="inline-flex items-center gap-1">
          <span>Pea is pointing at {pointer.label}</span>
          <Button
            label={`Dismiss ${pointer.label}`}
            onClick={() =>
              void callOp(
                { signal: new AbortController().signal },
                "pointers.dismiss",
                { thread, id: pointer.id },
              ).then((list) =>
                setPointers(list.pointers),
              )
            }
          >
            Dismiss
          </Button>
        </li>
      ))}
    </ul>
  );
}
