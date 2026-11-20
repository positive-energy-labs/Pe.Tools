import { afterEach, vi } from "vite-plus/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeFixture } from "./fans/fans-work-fixture.ts";

const closes: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of closes.splice(0).reverse()) await close();
  vi.unstubAllEnvs();
});

export async function projectFixture(
  family: boolean,
  routes?: () => NonNullable<Parameters<typeof nativeFixture>[3]>["routes"],
) {
  const root = await mkdtemp(join(tmpdir(), "pe-run-pointer-"));
  closes.push(() => rm(root, { recursive: true, force: true }));
  const firm = join(root, "04 PE Software Files", "Pe.Tools");
  const project = join(root, "Projects", "Example", "Pe.Tools");
  for (const [home, tier] of [
    [firm, "firm"],
    [project, "project"],
  ]) {
    await mkdir(home!, { recursive: true });
    await writeFile(join(home!, "pe-home.json"), JSON.stringify({ tier }));
  }
  vi.stubEnv("PE_TOOLS_SHARED_ROOT", firm);
  vi.stubEnv("PE_TOOLS_PRODUCT_HOME", join(root, "user"));
  const pod = join(project, "Pods", "project-only");
  await mkdir(pod, { recursive: true });
  await writeFile(join(pod, "pod.json"), JSON.stringify({ id: "project-only" }));
  const f = await nativeFixture("real", undefined, null, {
    routes: routes?.(),
    state: {
      activeDocumentIsFamilyDocument: family,
      openDocuments: [
        {
          openId: "selected-open",
          title: "Pointer fixture",
          isActive: true,
          isFamilyDocument: family,
          address: null,
          projectHome: "Projects/Example",
        },
      ],
    },
    native: (key) =>
      key === "family.capture"
        ? {
            observedAt: new Date().toISOString(),
            familyName: "Pointer family",
            modelJson: JSON.stringify({ family: { name: "Pointer family" } }),
            unmodeledCount: 0,
            coverage: {},
            issues: [],
            parameterUnits: {},
          }
        : key === "schedule.capture"
          ? { specJson: "{}" }
          : undefined,
  });
  closes.push(() => f.close());
  return { ...f, project, pod };
}
