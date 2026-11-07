import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { publishPodRoute } from "./pod-route-authoring.ts";
import { loadRouteArtifact, type RouteArtifactBytes } from "./src/route/route-artifact.ts";
import {
  module,
  data,
  initial,
  bodies,
} from "../../../examples/pods/snowdon-circuits/routes/voltage-drop/module.ts";
import { linkedCatalog } from "../../packages/agent-contracts/src/pe-api.ts";
import { podRouteDeclarationSchema } from "../../packages/host-contracts/src/pod-route.ts";

const root = fileURLToPath(new URL("../../../examples/pods/snowdon-circuits", import.meta.url));
const build = () =>
  publishPodRoute({
    entry: `${root}/routes/voltage-drop/module.ts`,
    root,
    data,
    slug: "voltage-drop",
    name: data.name,
    description: data.directory.summary,
    contracts: [
      {
        id: "kernel-data",
        bytes: new Uint8Array(
          readFileSync(
            new URL("../../packages/agent-contracts/src/route-kernel-data.ts", import.meta.url),
          ),
        ),
      },
    ],
  });
const evaluate = (bytes: Uint8Array) =>
  import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(bytes).toString("base64")}`);
function decode(bytes: Uint8Array): RouteArtifactBytes {
  return JSON.parse(new TextDecoder().decode(bytes), (key, value) =>
    key === "bytes" && Array.isArray(value) ? Uint8Array.from(value) : value,
  );
}

test("Snowdon publishes deterministic exact bytes and admits the decoded package against the catalog", async () => {
  const first = await build();
  const second = await build();
  expect(first.bytes).toEqual(second.bytes);
  expect(first.declaration).toEqual(second.declaration);
  expect(podRouteDeclarationSchema.parse(first.declaration)).toEqual(first.declaration);
  const loaded = await loadRouteArtifact(decode(first.bytes), [...linkedCatalog().entries.values()], evaluate);
  expect(loaded.ok, JSON.stringify(loaded)).toBe(true);
  if (!loaded.ok) throw Error(JSON.stringify(loaded.diagnostics));
  expect(loaded.route.workFingerprint).toBe(first.declaration.fingerprint);
  const changed = decode(first.bytes);
  changed.executables[0]!.members[0]!.bytes[0] ^= 1;
  await expect(loadRouteArtifact(changed, [...linkedCatalog().entries.values()], evaluate)).rejects.toThrow(
    "bytes or fingerprint differ",
  );
}, 30000);

test("Snowdon declares current Work and retains the copper calculation", () => {
  expect(data.work.version).toBe(2);
  expect(module.schemas.work.parse({})).toEqual({ version: 2, inputs: initial });
  const result = bodies.calculate.run({
    work: { inputs: initial },
    page: { worksheet: data.fields.worksheet.initial },
    readings: {},
  });
  expect(result.drop).toBeCloseTo((Math.sqrt(3) * 12.9 * 24 * 150) / 10380);
  expect(bodies.show.run(data.fields.worksheet.initial)).toBe("Copper voltage-drop worksheet");
});

// One falsifier for ADR 0028 rule 7: the authored module crosses exact-byte host and web admission.
test("typed Pod bytes register through the builtin door; changed bytes never acquire Work", async () => {
  const {mkdir,mkdtemp,writeFile,rm}=await import("node:fs/promises");
  const {resolve}=await import("node:path");
  const {createJiti}=await import("jiti");
  const {podRouteSkeleton}=await import("./src/route/pod-skeleton.ts");
  const {loadPodRoute}=await import("./src/route/pod-artifact.ts");
  const {admitPodArtifact:hostAdmit}=await import("../host/src/pod-artifact.ts");
  const {registerTypedRoute}=await import("./src/shell/route-registration.ts");
  const {publicRoutes}=await import("./src/route/route-discovery.ts");
  const {podRouteDescriptorSchema}=await import("@pe/agent-contracts");
  await mkdir(resolve(process.cwd(),".artifacts"),{recursive:true});
  const dir=await mkdtemp(resolve(process.cwd(),".artifacts/typed-pod-"));
  try {
    const entry=resolve(dir,"module.ts");
    await writeFile(entry,podRouteSkeleton("typed-proof","worksheet"));
    const loaded=await createJiti(import.meta.url).import<{module:import("./src/route/typed-route.ts").TypedRoute}>(entry);
    const built=await publishPodRoute({entry,root:dir,data:loaded.module.data,slug:"worksheet",name:"Worksheet",description:"Typed proof",contracts:[]});
    const artifact=JSON.parse(new TextDecoder().decode(built.bytes));
    const row=podRouteDescriptorSchema.parse({...built.declaration,key:"route:@typed-proof/routes/worksheet/route.artifact",packageId:"typed-proof",workRoute:"pod.typed-proof.worksheet",trusted:true});
    const host=await hostAdmit(artifact,row.fingerprint);
    expect(host.workFingerprint).toBe(row.fingerprint);
    expect(host.resolvedWork?.schema.parse({})).toEqual({notes:{}});
    const web=await loadPodRoute(row,{fingerprint:row.fingerprint,artifact},evaluate);
    const stop=registerTypedRoute(web.module,web.fingerprint);
    try {
      expect(publicRoutes.typed(row.workRoute)).toBe(web.module);
      const {mountTypedRoute}=await import("./src/shell/typed-mount.ts");
      let search=new URLSearchParams({note:JSON.stringify("mounted")});
      const mount=mountTypedRoute(web.module,{fixture:"typed-proof",target:null,work:{address:null,open:null},
        address:{read:()=>search,write:next=>{search=new URLSearchParams(next);},subscribe:()=>()=>{}},
        memory:()=>({}),custody:{current:()=>true}},web.fingerprint);
      try {
        expect(mount.draw("main")).toBe("mounted");
        mount.page.pose({note:"same typed shell"});
        expect(mount.draw("main")).toBe("same typed shell");
      } finally {mount.dispose();}

      expect(publicRoutes.get(row.workRoute)?.work?.admission?.fingerprint).toBe(host.workFingerprint);
      expect(publicRoutes.typed(publicRoutes.byAddress(web.module.data.address)!.manifest.key)).toBe(web.module);
    } finally {stop();}
    artifact.executables[0].members[0].bytes[0]^=1;
    await expect(hostAdmit(artifact,row.fingerprint)).rejects.toThrow("differ");
    await expect(loadPodRoute(row,{fingerprint:row.fingerprint,artifact},evaluate)).rejects.toThrow("differ");
    expect(publicRoutes.get(row.workRoute)).toBeUndefined();
  } finally {await rm(dir,{recursive:true,force:true});}
},60000);
