import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, test } from "vite-plus/test";
import { productionFiles } from "./import-census.ts";
import { root, syntax, walk, identity } from "./unification-2-census.ts";

function selectionSlots(source: ts.SourceFile): ts.Node[] {
  const found: ts.Node[] = [];
  walk(source, (n) => {
    if (!ts.isVariableDeclaration(n) || !n.initializer || !ts.isCallExpression(n.initializer))
      return;
    const call = n.initializer;
    if (!/^(?:React\.)?use(?:State|Ref)$/.test(call.expression.getText(source))) return;
    const name = ts.isArrayBindingPattern(n.name)
      ? n.name.elements[0]?.getText(source)
      : n.name.getText(source);
    // Only explicit selection names; excludes DOM refs and booleans such as selecting/open.
    if (
      !name ||
      !/^(?:selected(?:Ids?|Keys?|Rows?|Elements?|Threads?|Fans?)?|selection|picked(?:Ids?|Keys?)?|active(?:Id|Key))$/i.test(
        name,
      )
    )
      return;
    if (
      /^(?:boolean|HTML\w*Element)(?:\s*\|\s*null)?$/.test(
        call.typeArguments?.[0]?.getText(source) ?? "",
      )
    )
      return;
    if (["true", "false"].includes(call.arguments[0]?.getText(source) ?? "")) return;
    found.push(n);
  });
  return found;
}

test("production selection must belong to Page, not React", () => {
  const copies = productionFiles("apps/web/src")
    .filter(
      (file) =>
        file.endsWith(".tsx") &&
        !/^apps\/web\/src\/(?:shell|host|navigation|scene|kit|workbench|routes)\//.test(file),
    )
    .flatMap((file) =>
      selectionSlots(syntax(readFileSync(resolve(root, "ts", file), "utf8"), file)).map(identity),
    );
  expect(copies, copies.join("\n")).toEqual([]);
});

test("selection detector rejects state and refs while allowing DOM refs and booleans", () => {
  expect(
    selectionSlots(
      syntax(`
    const [selected, setSelected] = useState([]);
    const pickedIds = React.useRef([]);
    const [selection, setSelection] = useState<boolean>(false);
    const activeId = useRef<HTMLInputElement | null>(null);
  `),
    ),
  ).toHaveLength(2);
});
