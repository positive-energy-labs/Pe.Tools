import { resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vite-plus/test";
import { ROOT } from "./import-census.ts";

it("lets a product contract import all route helpers without browser dependencies", () => {
  const fixture = resolve(ROOT, "products/fans/contract/src/route-declaration-proof.ts").replaceAll(
    "\\",
    "/",
  );
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.NodeNext,
    lib: ["lib.es2023.d.ts"],
    types: [],
    strict: true,
    noEmit: true,
    skipLibCheck: true,
    allowImportingTsExtensions: true,
  };
  const host = ts.createCompilerHost(options);
  const getSourceFile = host.getSourceFile;
  host.getSourceFile = (file, ...args) =>
    file === fixture
      ? ts.createSourceFile(
          file,
          `export { field, picturePose, subjectSchema, stageField, listFields, read, hostRead }
            from "@pe/agent-contracts/route";`,
          args[0],
        )
      : getSourceFile(file, ...args);
  const program = ts.createProgram([fixture], options, host);
  const source = program.getSourceFile(fixture);
  if (!source) throw new Error(`Compiler did not load ${fixture}`);
  expect(
    program
      .getSemanticDiagnostics(source)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
  ).toEqual([]);
  expect(
    program
      .getSourceFiles()
      .map(({ fileName }) => fileName.replaceAll("\\", "/"))
      .filter((file) =>
        /\/(?:@pe\/(?:web[^/]*|kit)|(?:apps|packages)\/web[^/]*|products\/[^/]+\/web|(?:react|react-dom|@types\/(?:react|react-dom)))(?:\/|$)|\/lib\.dom[.]/.test(
          file,
        ),
      ),
  ).toEqual([]);
});
