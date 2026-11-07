import { useState } from "react";
import { Button } from "@pe/kit/lang/button";
import { ReviewSurface } from "./review-surface";
import type { TypedMount } from "./typed-mount";

/** Host-classified older Work can be set aside; unknown or corrupt Work stays inspectable. */
export function TypedWorkRecovery({ mount, owner }: { mount: TypedMount; owner?: string }) {
  const [review,setReview]=useState<NonNullable<ReturnType<TypedMount["startFreshAction"]>>|null>(null),[problem,setProblem]=useState<string|null>(null);
  const action=mount.startFreshAction(owner);
  const failure=mount.owner(owner)?.failure;
  return <>
    {failure&&<span role="alert">{failure.kind==="registration-mismatch"?"Route bytes differ from the host registration. Reload this tab.":failure.message}</span>}
    {problem&&<span role="alert">{problem}</span>}
    {action&&<Button label="Start fresh" busy={action.pending} onClick={()=>{setProblem(null);setReview(action);}}>Start fresh</Button>}
    {review&&<ReviewSurface label="Start fresh" sentence="Set the older Work aside and start empty Work at this same address." rows={[]} enabled={review.current&&!review.pending}
      refusal={!review.current?"Work changed; review the current Work again":review.pending?"Starting fresh...":null}
      confirm={()=>void review.run().then(()=>setReview(null)).catch(error=>setProblem(String(error)))} cancel={()=>setReview(null)} />}
  </>;
}
