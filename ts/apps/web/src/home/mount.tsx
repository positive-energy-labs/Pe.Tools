import {routeAddress} from "@pe/agent-contracts";
import { Directory } from "../navigation/directory";
import { Ledger } from "../navigation/ledger";
import { LEDGER_PRESENTATIONS } from "../navigation/ledger-model";
import type { AddressPage } from "../route";
import type { HomeContext } from "./route";
export function HomeBody({ ctx }: { ctx: HomeContext }) {
  const page: AddressPage<"home"> = [routeAddress("home").schema.parse(ctx.page.read()), patch => ctx.page.query(patch)];
  return <div className="grid min-h-full grid-cols-1 min-[1100px]:grid-cols-[minmax(0,30rem)_minmax(0,1fr)]">
    <div className="min-h-0 hairline-r max-[1099px]:max-h-[24rem] max-[1099px]:overflow-auto max-[1099px]:hairline-b"><Ledger presentation={LEDGER_PRESENTATIONS.home} /></div>
    <div className="min-w-0"><Directory page={page} /></div>
  </div>;
}
