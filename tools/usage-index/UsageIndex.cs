// Usage-example index generator for the local Revit API docs tool.
//
// Compiles the repo's C# source against the local Revit install assemblies and
// records, for every referenced Autodesk.Revit.* member, the doc-comment ID and
// the file/line-range of each usage site. The MCP joins this against the
// RevitAPI.xml BM25 index so search results point at real, uncut local code.
//
// Run:  dotnet run tools/usage-index/UsageIndex.cs -- \
//         --source source --revit "C:\Program Files\Autodesk\Revit 2026" \
//         --out .artifacts/usage-index/examples.json
//
// ponytail: single compilation without nuget refs — usages inside files that
// depend on unresolved packages can miss (var receivers); rerun under MSBuildWorkspace
// if coverage ever measurably matters.

#:package Microsoft.CodeAnalysis.CSharp@4.14.0
#:property JsonSerializerIsReflectionEnabledByDefault=true

using System.Text.Json;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Text;

string? sourceDir = null, revitDir = null, outPath = null;
for (var i = 0; i < args.Length; i++)
{
    switch (args[i])
    {
        case "--source": sourceDir = args[++i]; break;
        case "--revit": revitDir = args[++i]; break;
        case "--out": outPath = args[++i]; break;
    }
}
if (sourceDir is null || revitDir is null || outPath is null)
{
    Console.Error.WriteLine("usage: --source <dir> --revit <revit install dir> --out <examples.json>");
    return 1;
}
sourceDir = Path.GetFullPath(sourceDir);

var excluded = new[] { "\\obj\\", "\\bin\\", "\\.artifacts\\", "\\node_modules\\", "\\dist\\", "\\dist-installed\\", "\\Vendor\\", "\\vendor\\" };
var files = Directory.EnumerateFiles(sourceDir, "*.cs", SearchOption.AllDirectories)
    .Where(f => !excluded.Any(e => f.Contains(e, StringComparison.OrdinalIgnoreCase)))
    .ToList();
Console.WriteLine($"parsing {files.Count} files under {sourceDir}");

var parseOptions = new CSharpParseOptions(LanguageVersion.Latest);
var trees = files
    .AsParallel()
    .Select(f => CSharpSyntaxTree.ParseText(SourceText.From(File.ReadAllText(f)), parseOptions, path: f))
    .ToList();

var refs = new List<MetadataReference>();
foreach (var dll in new[] { "RevitAPI.dll", "RevitAPIUI.dll", "RevitAPIIFC.dll" })
{
    var p = Path.Combine(revitDir, dll);
    if (File.Exists(p)) refs.Add(MetadataReference.CreateFromFile(p));
}
if (refs.Count == 0)
{
    Console.Error.WriteLine($"no Revit API assemblies found in {revitDir}");
    return 1;
}
var tpa = (AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES") as string ?? "").Split(';', StringSplitOptions.RemoveEmptyEntries);
refs.AddRange(tpa.Where(p => p.EndsWith(".dll")).Select(p => (MetadataReference)MetadataReference.CreateFromFile(p)));

var compilation = CSharpCompilation.Create(
    "UsageIndex",
    trees,
    refs,
    new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary));

var sites = new Dictionary<string, List<(string File, int Start, int End, string Enclosing)>>();
var resolved = 0;

foreach (var tree in trees)
{
    // NB: ignoreAccessibility:true degrades ctor resolution to error symbols here — keep the plain model
    var model = compilation.GetSemanticModel(tree);
    var root = tree.GetRoot();

    foreach (var node in root.DescendantNodes())
    {
        ISymbol? symbol = node switch
        {
            InvocationExpressionSyntax or BaseObjectCreationExpressionSyntax or ElementAccessExpressionSyntax =>
                Resolve(model, node),
            MemberAccessExpressionSyntax ma when ma.Parent is not InvocationExpressionSyntax =>
                Resolve(model, ma),
            _ => null,
        };
        if (symbol is null or INamespaceSymbol) continue;
        if (symbol is IMethodSymbol { AssociatedSymbol: not null }) continue; // accessors surface via their property

        var assembly = symbol.ContainingAssembly?.Name ?? "";
        if (!assembly.StartsWith("RevitAPI", StringComparison.Ordinal)) continue;

        var docId = symbol.OriginalDefinition.GetDocumentationCommentId();
        // error-symbol fallbacks produce container-less IDs; they'd never join against RevitAPI.xml
        if (docId is null || !docId.StartsWith($"{docId[0]}:Autodesk.", StringComparison.Ordinal)) continue;

        var enclosingDecl = node.AncestorsAndSelf().FirstOrDefault(a =>
            a is MethodDeclarationSyntax or ConstructorDeclarationSyntax or PropertyDeclarationSyntax
              or LocalFunctionStatementSyntax or FieldDeclarationSyntax);
        if (enclosingDecl is null) continue;

        var span = enclosingDecl.GetLocation().GetLineSpan();
        var enclosingSymbol = model.GetEnclosingSymbol(node.SpanStart);
        var enclosingName = enclosingSymbol?.ToDisplayString(SymbolDisplayFormat.CSharpShortErrorMessageFormat) ?? "?";

        var relFile = Path.GetRelativePath(sourceDir, tree.FilePath).Replace('\\', '/');
        var entry = (relFile, span.StartLinePosition.Line + 1, span.EndLinePosition.Line + 1, enclosingName);

        if (!sites.TryGetValue(docId, out var list)) sites[docId] = list = new();
        if (!list.Contains(entry))
        {
            list.Add(entry);
            resolved++;
        }
    }
}

static ISymbol? Resolve(SemanticModel model, SyntaxNode node)
{
    var info = model.GetSymbolInfo(node);
    return info.Symbol ?? info.CandidateSymbols.FirstOrDefault();
}

// diverse-first: one site per file before repeats, capped per member
var members = sites.ToDictionary(
    kv => kv.Key,
    kv => kv.Value
        .GroupBy(s => s.File)
        .SelectMany(g => g.Select((s, i) => (Site: s, Round: i)))
        .OrderBy(x => x.Round).ThenBy(x => x.Site.File).ThenBy(x => x.Site.Start)
        .Take(20)
        .Select(x => new { file = x.Site.File, startLine = x.Site.Start, endLine = x.Site.End, enclosing = x.Site.Enclosing })
        .ToArray());

Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(outPath))!);
File.WriteAllText(outPath, JsonSerializer.Serialize(
    new { schemaVersion = 1, sourceRoot = sourceDir.Replace('\\', '/'), members },
    new JsonSerializerOptions { WriteIndented = false }));

Console.WriteLine($"indexed {members.Count} distinct API members, {resolved} usage sites -> {outPath}");
return 0;
