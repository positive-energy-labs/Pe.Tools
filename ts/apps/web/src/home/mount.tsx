import { Directory } from "../navigation/directory";
import { Ledger } from "../navigation/ledger";
import { LEDGER_PRESENTATIONS } from "../navigation/ledger-model";

import type { HomeContext } from "./route";
export function HomeBody({ ctx }: { ctx: HomeContext }) {
  const page: Parameters<typeof Directory>[0]["page"] = [
    ctx.page.read(),
    (patch) => ctx.page.query(patch),
  ];
  return (
    <div className="grid h-full min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(10rem,2fr)_minmax(0,3fr)] min-[1100px]:grid-cols-[minmax(0,30rem)_minmax(0,1fr)] min-[1100px]:grid-rows-1">
      <div className="min-h-0 overflow-auto hairline-r max-[1099px]:hairline-b">
        <Ledger presentation={LEDGER_PRESENTATIONS.home} />
      </div>
      <div className="min-h-0 min-w-0 overflow-hidden">
        <Directory page={page} />
      </div>
    </div>
  );
}
