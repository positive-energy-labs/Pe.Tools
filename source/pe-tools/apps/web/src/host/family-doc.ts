/**
 * Family-document access over `scripting.execute`. There is no dedicated host
 * op for FamilyManager yet, so these hooks run inline C# snippets: a ReadOnly
 * dump of parameters × types, and a WriteTransaction apply of staged edits.
 * ponytail: promote to a real bridge op when this route graduates.
 */
import { useMutation, useQuery } from "@tanstack/react-query";

import { callHostRpc } from "#/host/client";

export interface FamilyDocParameter {
  name: string;
  isInstance: boolean;
  formula: string;
  storageType: string;
  isReadOnly: boolean;
  /** typeName -> display value */
  values: Record<string, string>;
}

export interface FamilyDocSnapshot {
  familyName: string;
  types: string[];
  parameters: FamilyDocParameter[];
}

export interface FamilyDocEdit {
  paramName: string;
  typeName: string;
  value: string;
}

export interface FamilyDocApplyResult {
  applied: number;
  failures: string[];
}

// TODO: !!! We need to make a proper bridge op for this, and also add a DocumentKind categorization (Project, Family) to the operation def. Family-native operations will continue to grow

const JSON_START = "<<<PE_JSON>>>";
const JSON_END = "<<<PE_JSON_END>>>";

const READ_SCRIPT = `
public sealed class PeDumpFamilyParameters : PeScriptContainer
{
    public override void Execute()
    {
        var d = doc;
        if (d == null || !d.IsFamilyDocument)
        {
            WriteLine("${JSON_START}{\\"error\\":\\"not-family-document\\"}${JSON_END}");
            return;
        }

        var fm = d.FamilyManager;
        var types = new List<FamilyType>();
        foreach (FamilyType t in fm.Types) types.Add(t);

        var sb = new StringBuilder();
        sb.Append("{\\"familyName\\":").Append(Q(d.Title));
        sb.Append(",\\"types\\":[");
        for (var i = 0; i < types.Count; i++)
        {
            if (i > 0) sb.Append(',');
            sb.Append(Q(types[i].Name));
        }
        sb.Append("],\\"parameters\\":[");
        var firstParam = true;
        foreach (FamilyParameter p in fm.Parameters)
        {
            if (!firstParam) sb.Append(',');
            firstParam = false;
            sb.Append("{\\"name\\":").Append(Q(p.Definition.Name));
            sb.Append(",\\"isInstance\\":").Append(p.IsInstance ? "true" : "false");
            sb.Append(",\\"formula\\":").Append(Q(p.Formula ?? ""));
            sb.Append(",\\"storageType\\":").Append(Q(p.StorageType.ToString()));
            sb.Append(",\\"isReadOnly\\":").Append(p.IsReadOnly ? "true" : "false");
            sb.Append(",\\"values\\":{");
            for (var i = 0; i < types.Count; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(Q(types[i].Name)).Append(':').Append(Q(ValueOf(types[i], p)));
            }
            sb.Append("}}");
        }
        sb.Append("]}");
        WriteLine("${JSON_START}" + sb + "${JSON_END}");
    }

    private static string ValueOf(FamilyType t, FamilyParameter p)
    {
        try { var v = t.AsValueString(p); if (!string.IsNullOrEmpty(v)) return v; } catch { }
        try { var v = t.AsString(p); if (!string.IsNullOrEmpty(v)) return v; } catch { }
        try
        {
            switch (p.StorageType)
            {
                case StorageType.Integer: { var v = t.AsInteger(p); return v.HasValue ? v.Value.ToString() : ""; }
                case StorageType.Double: { var v = t.AsDouble(p); return v.HasValue ? v.Value.ToString() : ""; }
                case StorageType.ElementId: { var v = t.AsElementId(p); return v == null ? "" : v.ToString(); }
            }
        }
        catch { }
        return "";
    }

    private static string Q(string s)
    {
        var b = new StringBuilder("\\"");
        foreach (var c in s)
        {
            if (c == '"' || c == '\\\\') b.Append('\\\\').Append(c);
            else if (c == '\\n') b.Append("\\\\n");
            else if (c == '\\r') b.Append("\\\\r");
            else if (c == '\\t') b.Append("\\\\t");
            else if (c < ' ') b.Append(' ');
            else b.Append(c);
        }
        return b.Append('\\"').ToString();
    }
}
`;

function csString(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n")}"`;
}

function buildApplyScript(edits: FamilyDocEdit[]): string {
  const calls = edits
    .map(
      (edit) =>
        `        Apply(d, ${csString(edit.paramName)}, ${csString(edit.typeName)}, ${csString(edit.value)});`,
    )
    .join("\n");

  return `
public sealed class PeApplyFamilyParameterEdits : PeScriptContainer
{
    private int _applied;
    private readonly List<string> _failures = new List<string>();

    public override void Execute()
    {
        var d = doc;
        if (d == null || !d.IsFamilyDocument)
        {
            WriteLine("${JSON_START}{\\"error\\":\\"not-family-document\\"}${JSON_END}");
            return;
        }

${calls}

        var sb = new StringBuilder();
        sb.Append("{\\"applied\\":").Append(_applied).Append(",\\"failures\\":[");
        for (var i = 0; i < _failures.Count; i++)
        {
            if (i > 0) sb.Append(',');
            var f = _failures[i].Replace("\\\\", " ").Replace("\\"", "'").Replace("\\r", " ").Replace("\\n", " ");
            sb.Append('"').Append(f).Append('"');
        }
        sb.Append("]}");
        WriteLine("${JSON_START}" + sb + "${JSON_END}");
    }

    private void Apply(Document d, string paramName, string typeName, string value)
    {
        try
        {
            var fm = d.FamilyManager;
            var p = fm.get_Parameter(paramName);
            if (p == null) { _failures.Add(paramName + " (" + typeName + "): parameter not found"); return; }

            FamilyType target = null;
            foreach (FamilyType t in fm.Types) { if (t.Name == typeName) { target = t; break; } }
            if (target == null) { _failures.Add(paramName + " (" + typeName + "): type not found"); return; }

            fm.CurrentType = target;
            try { fm.SetValueString(p, value); _applied++; return; } catch { }
            switch (p.StorageType)
            {
                case StorageType.String: fm.Set(p, value); break;
                case StorageType.Integer: fm.Set(p, int.Parse(value)); break;
                case StorageType.Double: fm.Set(p, double.Parse(value, System.Globalization.CultureInfo.InvariantCulture)); break;
                default: throw new InvalidOperationException("Unsupported storage type " + p.StorageType);
            }
            _applied++;
        }
        catch (Exception ex)
        {
            _failures.Add(paramName + " (" + typeName + "): " + ex.Message);
        }
    }
}
`;
}

let bootstrapPromise: Promise<unknown> | null = null;
function ensureWorkspace(bridgeSessionId?: string): Promise<unknown> {
  bootstrapPromise ??= callHostRpc(
    "scripting.workspace.bootstrap",
    { workspaceKey: "default" },
    bridgeSessionId ? { bridgeSessionId } : undefined,
  );
  return bootstrapPromise;
}

async function executeScript(
  scriptContent: string,
  permissionMode: "ReadOnly" | "WriteTransaction",
  bridgeSessionId?: string,
): Promise<string> {
  await ensureWorkspace(bridgeSessionId);
  const result = await callHostRpc(
    "scripting.execute",
    {
      workspaceKey: "default",
      permissionMode,
      scriptContent,
      sourceName: "pdf-audit.cs",
    },
    bridgeSessionId ? { bridgeSessionId } : undefined,
  );
  if (result.status !== "Succeeded") {
    const diagnostics = result.diagnostics.map((d) => d.message).join("; ");
    throw new Error(`${result.status}: ${diagnostics || result.output || "script failed"}`);
  }
  return result.output;
}

function extractJson<T>(output: string): T {
  const start = output.indexOf(JSON_START);
  const end = output.indexOf(JSON_END);
  if (start < 0 || end <= start) {
    throw new Error(`script produced no result payload: ${output.slice(0, 300)}`);
  }
  const parsed = JSON.parse(output.slice(start + JSON_START.length, end)) as T & {
    error?: string;
  };
  if (parsed.error) throw new Error(parsed.error);
  return parsed;
}

export function useFamilyDocSnapshotQuery(bridgeSessionId?: string) {
  return useQuery({
    queryKey: ["pe-host", bridgeSessionId ?? "", "family-doc-snapshot"],
    queryFn: async () =>
      extractJson<FamilyDocSnapshot>(await executeScript(READ_SCRIPT, "ReadOnly", bridgeSessionId)),
    enabled: false,
    retry: false,
    staleTime: Infinity,
    gcTime: 10 * 60 * 1000,
  });
}

export function useFamilyDocApplyMutation(bridgeSessionId?: string) {
  return useMutation({
    mutationFn: async (edits: FamilyDocEdit[]) =>
      extractJson<FamilyDocApplyResult>(
        await executeScript(buildApplyScript(edits), "WriteTransaction", bridgeSessionId),
      ),
  });
}
