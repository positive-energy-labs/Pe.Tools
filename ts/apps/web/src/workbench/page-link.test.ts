import { expect, test, vi } from "vite-plus/test";
import { routeAddress } from "@pe/agent-contracts";
import { pageLink } from "./page-link";

test("Page links use the existing viewer only for this frontend or its exact runtime owner", () => {
  vi.stubEnv("PE_RUNTIME_ORIGIN", "http://127.0.0.1:60914");
  try {
    const front = "http://127.0.0.1:5175/ducts?thread=kept";
    for (const origin of ["", "http://127.0.0.1:5175", "http://127.0.0.1:60914"]) {
      for (const slug of ["chadds-duct-readiness", "my-pod--report"]) {
        const link = pageLink(`${origin}/pages/${slug}/`, front);
        expect(link?.slug).toBe(slug);
        expect(
          routeAddress("bind").read(Object.fromEntries(new URL(link!.href, front).searchParams)),
        ).toMatchObject({ page: { page: slug, view: true }, carry: {} });
      }
    }
    expect(pageLink("/pages/report/?scope=all#airflow", front)?.page).toEqual({
      page: "report",
      view: true,
      query: "scope=all",
      fragment: "airflow",
    });
    for (const path of [
      "http://127.0.0.1:60915/pages/report/",
      "https://example.com/pages/report/",
      "http://human@127.0.0.1:60914/pages/report/",
      "/pages/report/act",
      "/pages/report/logo.png",
      "/pages/%2Freport/",
      "/pages/bad--pod--page/",
      "mailto:report@example.com",
    ])
      expect(pageLink(path, front), path).toBeNull();
  } finally {
    vi.unstubAllEnvs();
  }
});
