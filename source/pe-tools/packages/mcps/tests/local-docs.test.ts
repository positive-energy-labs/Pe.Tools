import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vite-plus/test";
import {
  fetchLocalDoc,
  findRevitInstallXmls,
  parseDocXml,
  parseMemberId,
  searchLocalDocs,
  splitCamel,
} from "../src/shared/rvt-api/local-docs.ts";

const FIXTURE_XML = `<?xml version="1.0"?>
<doc>
  <assembly>"RevitAPI"</assembly>
  <members>
    <member name="T:Autodesk.Revit.DB.FilteredElementCollector">
      <summary>Searches, filters and iterates through a set of elements.</summary>
      <remarks>Developers can assign a variety of conditions to filter the elements.</remarks>
    </member>
    <member name="M:Autodesk.Revit.DB.JoinGeometryUtils.GetJoinedElements(Autodesk.Revit.DB.Document,Autodesk.Revit.DB.Element)">
      <summary>Returns all elements joined to given element.</summary>
      <remarks>This functionality is not available for family documents.</remarks>
      <param name="document">The document containing the element.</param>
      <returns>The set of elements that are joined to the given element.</returns>
      <exception cref="T:Autodesk.Revit.Exceptions.ArgumentException">document is not a project document.</exception>
      <since>2014</since>
    </member>
    <member name="P:Autodesk.Revit.DB.Wall.Flipped">
      <summary>Property reporting whether the wall is flipped.</summary>
    </member>
    <member name="M:Autodesk.Revit.DB.Wall.#ctor">
      <summary>Fake constructor for testing.</summary>
    </member>
    <member name="T:Autodesk.Revit.DB.IExternalEventHandler">
      <summary>An interface for handling external events.</summary>
    </member>
  </members>
</doc>`;

const tempDirs: string[] = [];
function makeFixture(): { xmlPath: string; cacheDir: string } {
  const dir = mkdtempSync(join(tmpdir(), "pe-local-docs-"));
  tempDirs.push(dir);
  const xmlPath = join(dir, "RevitAPI.xml");
  writeFileSync(xmlPath, FIXTURE_XML);
  return { xmlPath, cacheDir: join(dir, "cache") };
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

test("parseDocXml extracts summary, remarks, params, exceptions, since", () => {
  const members = parseDocXml(FIXTURE_XML, "RevitAPI");
  expect(members).toHaveLength(5);
  const join = members.find((m) => m.name === "GetJoinedElements");
  expect(join?.kind).toBe("Method");
  expect(join?.declaringType).toBe("JoinGeometryUtils");
  expect(join?.namespace).toBe("Autodesk.Revit.DB");
  expect(join?.remarks).toContain("not available for family documents");
  expect(join?.extras).toContain("document is not a project document");
  expect(join?.since).toBe("2014");
});

test("parseMemberId classifies kinds", () => {
  expect(parseMemberId("T:A.B.Widget").kind).toBe("Class");
  expect(parseMemberId("T:A.B.IWidget").kind).toBe("Interface");
  expect(parseMemberId("M:A.B.Widget.#ctor").kind).toBe("Constructor");
  expect(parseMemberId("P:A.B.Widget.Size").kind).toBe("Property");
  expect(parseMemberId("M:A.B.Widget.Do(System.String)").signature).toBe("(System.String)");
});

test("splitCamel splits identifiers", () => {
  expect(splitCamel("FilteredElementCollector")).toEqual(["Filtered", "Element", "Collector"]);
  expect(splitCamel("join geometry")).toEqual(["join", "geometry"]);
});

test("search matches camelCase identifiers and natural-language remarks", () => {
  const { xmlPath, cacheDir } = makeFixture();
  const opts = { xmlPaths: [xmlPath], cacheDir };

  const byName = searchLocalDocs("element collector", 2099, 5, undefined, opts);
  expect(byName?.[0]?.title).toContain("FilteredElementCollector");

  const byRemarks = searchLocalDocs("join family documents", 2099, 5, undefined, opts);
  expect(byRemarks?.some((r) => r.memberId.includes("GetJoinedElements"))).toBe(true);
  const hit = byRemarks?.find((r) => r.memberId.includes("GetJoinedElements"));
  expect(hit?.remarks).toContain("family documents");
  expect(hit?.since).toBe("2014");
  expect(hit?.url).toBe(
    "local:M:Autodesk.Revit.DB.JoinGeometryUtils.GetJoinedElements(Autodesk.Revit.DB.Document,Autodesk.Revit.DB.Element)",
  );
});

test("type filter and index cache reuse", () => {
  const { xmlPath, cacheDir } = makeFixture();
  const opts = { xmlPaths: [xmlPath], cacheDir };

  const onlyProps = searchLocalDocs("wall", 2099, 5, ["Property"], opts);
  expect(onlyProps?.every((r) => r.type === "Property")).toBe(true);
  expect(onlyProps?.some((r) => r.title.includes("Flipped"))).toBe(true);

  // second call hits the cached sqlite file (same fingerprint)
  const again = searchLocalDocs("wall", 2099, 5, ["Property"], opts);
  expect(again?.length).toBe(onlyProps?.length);
});

test("examples join attaches local file paths and boosts results", () => {
  const { xmlPath, cacheDir } = makeFixture();
  const examplesPath = join(cacheDir, "..", "examples.json");
  writeFileSync(
    examplesPath,
    JSON.stringify({
      schemaVersion: 1,
      sourceRoot: ".",
      members: {
        "M:Autodesk.Revit.DB.JoinGeometryUtils.GetJoinedElements(Autodesk.Revit.DB.Document,Autodesk.Revit.DB.Element)":
          [{ file: "Example.cs", startLine: 10, endLine: 30, enclosing: "Pe.App.Demo.Run" }],
      },
    }),
  );
  const results = searchLocalDocs("joined elements", 2099, 5, undefined, {
    xmlPaths: [xmlPath],
    cacheDir,
    examplesPath,
  });
  const hit = results?.find((r) => r.memberId.includes("GetJoinedElements"));
  expect(hit?.examples?.[0]?.enclosing).toBe("Pe.App.Demo.Run");
  expect(hit?.examples?.[0]?.file.endsWith("Example.cs")).toBe(true);
  expect(hit?.examples?.[0]?.file).not.toBe("Example.cs"); // resolved to absolute
});

test("fetchLocalDoc renders full member markdown", () => {
  const { xmlPath, cacheDir } = makeFixture();
  const doc = fetchLocalDoc(
    "M:Autodesk.Revit.DB.JoinGeometryUtils.GetJoinedElements(Autodesk.Revit.DB.Document,Autodesk.Revit.DB.Element)",
    2099,
    { xmlPaths: [xmlPath], cacheDir },
  );
  expect(doc).toContain("## Summary");
  expect(doc).toContain("## Remarks");
  expect(doc).toContain("Since:** Revit 2014");
});

// Real-install smoke: runs only where a Revit install exists (dev machines), skipped elsewhere.
test.skipIf(findRevitInstallXmls(2026).length === 0)(
  "real install: indexes and searches the actual RevitAPI.xml corpus",
  () => {
    const { cacheDir } = makeFixture();
    const results = searchLocalDocs("filtered element collector", 2026, 5, undefined, { cacheDir });
    expect(results?.some((r) => r.title.includes("FilteredElementCollector"))).toBe(true);
  },
  60_000,
);
