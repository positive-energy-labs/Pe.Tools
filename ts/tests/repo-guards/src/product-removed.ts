/**
 * Prints, as one JSON line, the errors of the host program with each product removed from the
 * generated registration in turn. The guard runs this in a child process: four whole programs
 * outgrow a test worker.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import ts from "typescript";
import { ROOT } from "./import-census.ts";
import { productAssemblyPaths } from "../../../apps/web/scripts/product-assembly.ts";

const registration = resolve(ROOT, productAssemblyPaths.executors.slice("ts/".length));
const config = resolve(dirname(registration), "../tsconfig.json");
const generated = readFileSync(registration, "utf8");
const hosts = [...generated.matchAll(/^import \{ host as (host\d+) \} from "([^"]+)";\r?\n/gm)];
if (hosts.length < 2) throw Error("The registration imports no product hosts");

const parsed = ts.getParsedCommandLineOfConfigFile(config, undefined, {
  ...ts.sys,
  onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
    throw Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
  },
});
if (!parsed) throw Error(`No TypeScript program at ${config}`);
const options = { ...parsed.options, noEmit: true, incremental: false, composite: false };

const broken = hosts.flatMap(([line, name = "", from]) => {
  // The registration as the generator would write it with this product gone.
  const text = generated
    .replace(line, "")
    .replace(new RegExp(`\\b${name}, |, ${name}(?=\\])|\\b${name}(?=\\])`), "")
    // A type the registration derives from every product loses this one's term, so the error
    // reported is the generic line that reads the term's members.
    .replace(new RegExp(` & [^&;]*\\b${name}\\b[^&;]*|= [^&;]*\\b${name}\\b[^&;]* & `), (term) =>
      term.startsWith("=") ? "= " : "",
    );
  if (text.includes(name)) throw Error(`${from} did not leave the registration`);
  const host = ts.createCompilerHost(options);
  const read = host.readFile.bind(host);
  host.readFile = (file) => (resolve(file) === registration ? text : read(file));
  return ts
    .getPreEmitDiagnostics(ts.createProgram(parsed.fileNames, options, host))
    .filter(({ category }) => category === ts.DiagnosticCategory.Error)
    .slice(0, 5)
    .map(({ file, start, messageText }) => {
      const at = file
        ? `${file.fileName}(${file.getLineAndCharacterOfPosition(start ?? 0).line + 1})`
        : "";
      return `without ${from}: ${at} ${ts.flattenDiagnosticMessageText(messageText, " ")}`;
    });
});
console.log(JSON.stringify(broken));
