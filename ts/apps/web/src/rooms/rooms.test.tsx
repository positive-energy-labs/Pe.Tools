// @vitest-environment jsdom
import { roomEditKey, roomsRouteState, stagedRoomWrites } from "@pe/agent-contracts";
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vite-plus/test";
import { DEMO_PLAN, DEMO_ROOMS, DEMO_VIEW } from "./demo";
import { roomsPageSchema } from "./page";
import { RoomsPlan } from "./plan";
import { Pane } from "@pe/kit/lang/pane";
import { RoomsTable, roomRows } from "./table";
import { scrollBody } from "../route/body";

test("stagedRoomWrites sends both authors staged values per guid", () => {
  const doc = roomsRouteState.schema.parse({
    edits: {
      [roomEditKey("a", "name")]: { edit: { value: "Pantry" } },
      [roomEditKey("a", "people")]: { edit: { value: 2 } },
      [roomEditKey("b", "type")]: { edit: { value: "kitchen" } },
      [roomEditKey("b", "role")]: { edit: { value: "zone" } },
      [roomEditKey("b", "ceilingFt")]: { edit: { value: 9 } },
      [roomEditKey("c", "name")]: { edit: { value: "Pea's idea" } },
    },
  });
  expect(stagedRoomWrites(doc)).toEqual([
    { guid: "a", name: "Pantry", people: 2 },
    { guid: "b", type: "kitchen", role: "zone", ceilingFt: 9 },
    { guid: "c", name: "Pea's idea" },
  ]);
  expect(
    roomsRouteState.schema.safeParse({
      edits: { [roomEditKey("a", "role")]: { edit: { value: "held" } } },
    }).success,
  ).toBe(false);
});

test("the Work refuses a value its field does not accept", () => {
  expect(
    roomsRouteState.schema.safeParse({
      edits: { [roomEditKey("a", "people")]: { edit: { value: "two" } } },
    }).success,
  ).toBe(false);
  expect(
    roomsRouteState.schema.safeParse({ edits: { '["a"]': { edit: { value: 1 } } } }).success,
  ).toBe(false);
});

test("a locked stale region keeps both facts in the plan, legend and table, and still selects", async () => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private read: ResizeObserverCallback) {}
      observe() {
        this.read(
          [{ contentRect: { width: 800, height: 600 } }] as ResizeObserverEntry[],
          this as unknown as ResizeObserver,
        );
      }
      unobserve() {}
      disconnect() {}
    },
  );
  // 00000000-0000-4000-8000-000000000001 is locked; make it stale as well. 00000000-0000-4000-8000-000000000002 is stale alone.
  const regions = DEMO_ROOMS.regions.map((region) =>
    region.guid === "00000000-0000-4000-8000-000000000001" ? { ...region, stale: true } : region,
  );
  const rows = roomRows(regions, ["Fixture level"]);
  const page = roomsPageSchema.parse({ view: DEMO_VIEW });
  const onSelect = vi.fn();
  const view = render(
    <>
      <RoomsTable rows={rows} onSelect={() => {}} empty={{ says: "empty", exit: "none" }} />
      <RoomsPlan
        renderPane={(body, furniture) => (
          <Pane picture {...furniture}>
            {body}
          </Pane>
        )}
        rows={rows}
        plan={DEMO_PLAN}
        planRefusal={null}
        planError={null}
        empty={null}
        onSelect={onSelect}
        trace={{ data: null, none: "fixture" }}
        page={{ read: () => page, pose: () => {} }}
      />
    </>,
  );
  const path = view.container.querySelector<SVGPathElement>(
    'path[data-subject="room:00000000-0000-4000-8000-000000000001"]',
  )!;
  expect(path.getAttribute("data-state")).toBe("locked");
  expect(path.getAttribute("data-stale")).toBe("true");
  await waitFor(() => expect(path.getAttribute("aria-description")).toBe("locked · stale"));
  // Locked keeps the outline; the fill takes stale's caution ink.
  expect(path.getAttribute("stroke")).not.toBe(path.getAttribute("fill"));
  expect(path.getAttribute("fill")).toContain(
    view.container
      .querySelector('path[data-subject="room:00000000-0000-4000-8000-000000000002"]')!
      .getAttribute("stroke"),
  );
  const legend = view.container.querySelector('[aria-label="rooms legend"]')!.textContent!;
  expect(legend).toMatch(/locked\D*1/);
  expect(legend).toMatch(/stale\D*2/);
  expect(
    view.container.querySelector('tr[data-subject="room:00000000-0000-4000-8000-000000000001"]')!
      .textContent,
  ).toContain("locked · stale");
  fireEvent.click(path);
  expect(onSelect).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001", false);
  cleanup();
  vi.unstubAllGlobals();
});


test("pending Values retain Rooms navigation while edits refuse, then reject late deliveries",async()=>{
  const {act,screen}=await import("@testing-library/react");
  const {useSyncExternalStore}=await import("react");
  const {module}=await import("./route");
  const {ScopeBody}=await import("./mount");
  const {RoomsProvider}=await import("./workspace");
  const {mountTypedRoute}=await import("../shell/typed-mount");
  const {createFixtureWorkDoor}=await import("../shell/fixture-work-door");
  const {retainedValueLabel}=await import("../shell/typed-shell");
  const {workFingerprintSchema}=await import("@pe/agent-contracts");
  const frames:Parameters<import("../shell/source-contract").UseSource["open"]>[1][]=[];
  let search=new URLSearchParams();
  const mount=mountTypedRoute({...module,spec:{...module.spec,panes:{main:{...module.spec.panes.main,body:"scroll" as const,draw:(ctx:any)=>scrollBody(ctx)}}}},
    {address:{read:()=>search,write:next=>{search=next;},subscribe:()=>()=>{}},fixture:null,target:{kind:"document",ref:{session:"retained",openId:"rooms"}},
      work:{address:null,open:{session:"retained",openId:"rooms"}},custody:{current:()=>true},memory:()=>({})},
    workFingerprintSchema.parse(`builtin-closure:${"a".repeat(64)}`),{work:createFixtureWorkDoor(roomsRouteState,roomsRouteState.schema.parse({})),
      sources:{"rooms.workspace":{kind:"use",open:(_context,deliver)=>{frames.push(deliver);return ()=>{};}}}});
  const ctx=()=>mount.draw("main") as import("./route").RoomsContext;
  const packet=(label:string)=>({key:"retained",generation:0,version:1,state:"current",value:{
    data:{roomsWork:roomsRouteState.schema.parse({}),handle:null,snapshot:{...DEMO_ROOMS,levels:[{name:label,elevation:0,views:["First view","Second view"]}]},trace:null,traceError:null,plan:null,planError:null},
    evaluation:label,inputs:"retained",origin:{kind:"fixture"},trace:[],freshness:"current",coverage:{requested:[],covered:[],unknown:[],refused:[]}}});
  const emit=(index:number,label:string)=>frames[index]!({kind:"complete",revision:1,value:packet(label)});
  function Chooser(){useSyncExternalStore(mount.subscribe,mount.revision,mount.revision);const current=ctx();return <RoomsProvider ctx={current}>
    <ScopeBody ctx={current} page={roomsPageSchema.parse({...current.page.read(),selected:current.page.read().picked})} verbs={()=>null}/>
    <output>{retainedValueLabel(current.value)}</output></RoomsProvider>;}
  try {
    emit(0,"Fixture level");
    await vi.waitFor(()=>expect(ctx().cells.ready).toBe(true));
    render(<Chooser/>);
    fireEvent.click(screen.getByRole("button",{name:"Choose level"}));
    fireEvent.click(await screen.findByRole("option",{name:/Fixture level/}));
    expect(mount.page.read().view).toBe("First view");
    expect(ctx().value).toMatchObject({current:false,status:"pending",publication:{freshness:"refresh-needed"}});
    expect(screen.getByText("Showing previous Value; refreshing")).toBeTruthy();
    expect(ctx().cells.ready).toBe(false);
    expect(await ctx().cells.at(["edits",roomEditKey(DEMO_ROOMS.regions[0]!.guid,"name")]).stage("Unsafe")).not.toBeNull();
    fireEvent.click(await screen.findByRole("option",{name:"Second view"}));
    expect(mount.page.read().view).toBe("Second view");
    await act(async()=>emit(frames.length-1,"Replacement floor"));
    expect(ctx().value.current).toBe(true);
    expect(screen.queryByText("Showing previous Value; refreshing")).toBeNull();
    await act(async()=>emit(0,"Late old floor"));
    expect(ctx().value.value?.snapshot.levels[0]!.name).toBe("Replacement floor");
    await act(async()=>mount.refresh());
    await act(async()=>frames.at(-1)!({kind:"failure",error:"Offline"}));
    expect(screen.getByText("Showing previous Value; refresh needed")).toBeTruthy();
    expect(ctx().cells.ready).toBe(false);
  } finally {cleanup();mount.dispose();}
});
