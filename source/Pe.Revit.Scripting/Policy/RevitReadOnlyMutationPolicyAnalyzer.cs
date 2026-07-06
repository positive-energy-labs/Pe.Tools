using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Pe.Revit.Scripting.Bootstrap;
using Pe.Shared.HostContracts.Scripting;
using Pe.Shared.Scripting.Diagnostics;
using Pe.Shared.Scripting.Execution;

namespace Pe.Revit.Scripting.Policy;

internal sealed class RevitReadOnlyMutationPolicyAnalyzer {
    private static readonly IReadOnlyDictionary<string, IReadOnlyCollection<string>> RejectedMethodsByType =
        new Dictionary<string, IReadOnlyCollection<string>>(StringComparer.Ordinal) {
            ["Autodesk.Revit.DB.Document"] = new HashSet<string>(StringComparer.Ordinal) {
                "Delete",
                "EditFamily",
                "LoadFamily"
            },
            ["Autodesk.Revit.DB.Parameter"] = new HashSet<string>(StringComparer.Ordinal) {
                "Set",
                "SetValueString"
            },
            ["Autodesk.Revit.DB.FamilyManager"] = new HashSet<string>(StringComparer.Ordinal) {
                "AddParameter",
                "DeleteCurrentType",
                "MakeInstance",
                "MakeType",
                "NewType",
                "RemoveParameter",
                "RenameCurrentType",
                "RenameParameter",
                "ReorderParameters",
                "ReplaceParameter",
                "Set",
                "SetDescription",
                "SetFormula"
            },
            ["Autodesk.Revit.UI.UIApplication"] = new HashSet<string>(StringComparer.Ordinal) {
                "PostCommand"
            },
            ["UIFrameworkServices.QuickAccessToolBarService"] = new HashSet<string>(StringComparer.Ordinal) {
                "performMultipleUndoRedoOperations"
            },
            ["Pe.Revit.FamilyFoundry.OperationProcessor"] = new HashSet<string>(StringComparer.Ordinal) {
                "ProcessQueue",
                "ProcessQueueDangerously"
            },
            ["Pe.Revit.FamilyFoundry.Apply.FamilyProfileApplicator"] = new HashSet<string>(StringComparer.Ordinal) {
                "ApplyMigrationProfile",
                "ApplyProfile"
            },
            ["Pe.Revit.FamilyFoundry.Apply.DocumentFamilyProfileApplyExtensions"] =
                new HashSet<string>(StringComparer.Ordinal) {
                    "ApplyDesiredFamilyMigrationProfile",
                    "ApplyFamilyMigrationProfile",
                    "ApplyFamilyProfile"
                },
            ["Pe.Revit.FamilyFoundry.FamilyProcessingPipelineExtensions"] =
                new HashSet<string>(StringComparer.Ordinal) {
                    "Load",
                    "Process",
                    "SaveToPaths"
                },
            ["Pe.Revit.Extensions.FamDocument.FamilyDocumentAddParameter"] =
                new HashSet<string>(StringComparer.Ordinal) {
                    "AddFamilyParameter",
                    "AddSharedParameter"
                },
            ["Pe.Revit.Extensions.FamDocument.FamilyDocumentProcessFamily"] =
                new HashSet<string>(StringComparer.Ordinal) {
                    "EnsureDefaultType",
                    "LoadAndClose",
                    "Process",
                    "ProcessAndSaveVariant",
                    "SaveToPaths"
                },
            ["Pe.Revit.Extensions.FamDocument.FamilyDocumentSetValue"] =
                new HashSet<string>(StringComparer.Ordinal) {
                    "SetValue",
                    "TrySetUnsetFormula"
                },
            ["Pe.Revit.Extensions.FamDocument.Formula"] = new HashSet<string>(StringComparer.Ordinal) {
                "TrySetFormula",
                "TrySetFormulaFast",
                "UnsetFormula"
            },
            ["System.Reflection.ConstructorInfo"] = new HashSet<string>(StringComparer.Ordinal) {
                "Invoke"
            },
            ["System.Reflection.FieldInfo"] = new HashSet<string>(StringComparer.Ordinal) {
                "SetValue"
            },
            ["System.Reflection.MethodBase"] = new HashSet<string>(StringComparer.Ordinal) {
                "Invoke"
            },
            ["System.Reflection.MethodInfo"] = new HashSet<string>(StringComparer.Ordinal) {
                "Invoke"
            },
            ["System.Reflection.PropertyInfo"] = new HashSet<string>(StringComparer.Ordinal) {
                "SetValue"
            },
            ["System.Type"] = new HashSet<string>(StringComparer.Ordinal) {
                "InvokeMember"
            }
        };

    private static readonly HashSet<string> RejectedConstructorTypes = new(StringComparer.Ordinal) {
        "Autodesk.Revit.DB.SubTransaction",
        "Autodesk.Revit.DB.Transaction",
        "Autodesk.Revit.DB.TransactionGroup"
    };

    private static readonly HashSet<string> RejectedCreationFactoryTypes = new(StringComparer.Ordinal) {
        "Autodesk.Revit.Creation.Document",
        "Autodesk.Revit.Creation.FamilyItemFactory"
    };

    private const string GlobalUsingsFileName = "__PeScriptUsings.g.cs";

    public IReadOnlyList<ScriptDiagnostic> Analyze(
        ScriptSourceSet sourceSet,
        IReadOnlyList<MetadataReference> metadataReferences,
        IReadOnlyList<string> projectUsings
    ) {
        var syntaxTrees = CreateSyntaxTrees(sourceSet, projectUsings);
        var compilation = CSharpCompilation.Create(
            $"PeScriptPolicy_{Guid.NewGuid():N}",
            syntaxTrees,
            metadataReferences,
            new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary)
        );

        // Policy judges the selected entrypoint file plus every pod-declared method/constructor it
        // transitively invokes — NOT every file compiled into the pod. Pod libraries legitimately
        // carry mutating helpers for their write-mode entrypoints; a read-only entrypoint that never
        // reaches them must stay runnable as ReadOnly. Anything this static walk cannot see
        // (delegates/method groups, property accessors, partials) still hits Revit's
        // no-transaction guard at runtime, backed by the document mutation monitor.
        var podTrees = syntaxTrees.Where(tree => tree.FilePath != GlobalUsingsFileName).ToHashSet();
        var entryTree = podTrees.FirstOrDefault(tree =>
            string.Equals(tree.FilePath, sourceSet.EntryPointSourceName, StringComparison.Ordinal));

        var pendingScopes = new Queue<(SyntaxNode Scope, SyntaxTree Tree)>();
        var fullyAnalyzedTrees = new HashSet<SyntaxTree>();
        if (entryTree is null) {
            foreach (var tree in podTrees) {
                _ = fullyAnalyzedTrees.Add(tree);
                pendingScopes.Enqueue((tree.GetCompilationUnitRoot(), tree));
            }
        } else {
            _ = fullyAnalyzedTrees.Add(entryTree);
            pendingScopes.Enqueue((entryTree.GetCompilationUnitRoot(), entryTree));
        }

        var visitedDeclarations = new HashSet<IMethodSymbol>(SymbolEqualityComparer.Default);
        void EnqueuePodDeclarations(IMethodSymbol symbol) {
            var definition = (symbol.ReducedFrom ?? symbol).OriginalDefinition;
            if (!definition.Locations.Any(location => location.IsInSource))
                return;
            if (!visitedDeclarations.Add(definition))
                return;

            foreach (var reference in definition.DeclaringSyntaxReferences) {
                if (!podTrees.Contains(reference.SyntaxTree) || fullyAnalyzedTrees.Contains(reference.SyntaxTree))
                    continue;

                pendingScopes.Enqueue((reference.GetSyntax(), reference.SyntaxTree));
            }
        }

        var diagnostics = new List<ScriptDiagnostic>();
        var semanticModels = new Dictionary<SyntaxTree, SemanticModel>();
        while (pendingScopes.Count > 0) {
            var (scope, tree) = pendingScopes.Dequeue();
            if (!semanticModels.TryGetValue(tree, out var semanticModel)) {
                semanticModel = compilation.GetSemanticModel(tree, ignoreAccessibility: true);
                semanticModels[tree] = semanticModel;
            }

            diagnostics.AddRange(AnalyzeDynamicUsage(scope, tree.FilePath));
            diagnostics.AddRange(AnalyzeObjectCreation(scope, semanticModel, tree.FilePath, EnqueuePodDeclarations));
            diagnostics.AddRange(AnalyzeInvocations(scope, semanticModel, tree.FilePath, EnqueuePodDeclarations));
        }

        return diagnostics;
    }

    private static IReadOnlyList<SyntaxTree> CreateSyntaxTrees(
        ScriptSourceSet sourceSet,
        IReadOnlyList<string> projectUsings
    ) {
        var parseOptions = new CSharpParseOptions(LanguageVersion.Latest);
        var trees = new List<SyntaxTree> {
            CSharpSyntaxTree.ParseText(
                ScriptCompilationService.CreateGlobalUsingsSource(ScriptFileTemplates.DefaultUsings, projectUsings),
                parseOptions,
                GlobalUsingsFileName
            )
        };

        trees.AddRange(sourceSet.Files.Select(sourceFile =>
            CSharpSyntaxTree.ParseText(sourceFile.Content, parseOptions, sourceFile.Name)));
        return trees;
    }

    private static IEnumerable<ScriptDiagnostic> AnalyzeDynamicUsage(
        SyntaxNode scope,
        string sourceName
    ) {
        foreach (var predefinedType in scope.DescendantNodesAndSelf().OfType<PredefinedTypeSyntax>()) {
            if (predefinedType.Keyword.ValueText.Equals("dynamic", StringComparison.Ordinal)) {
                yield return CreateRejectedDiagnostic(
                    "dynamic dispatch",
                    "ReadOnly scripts may not use dynamic dispatch because it can hide Revit document mutations from static policy.",
                    sourceName
                );
            }
        }
    }

    private static IEnumerable<ScriptDiagnostic> AnalyzeObjectCreation(
        SyntaxNode scope,
        SemanticModel semanticModel,
        string sourceName,
        Action<IMethodSymbol> enqueuePodDeclaration
    ) {
        foreach (var creation in scope.DescendantNodesAndSelf().OfType<ObjectCreationExpressionSyntax>()) {
            var symbol = semanticModel.GetSymbolInfo(creation).Symbol as IMethodSymbol;
            var constructedType = symbol?.ContainingType.ToDisplayString();
            if (constructedType is null || symbol is null)
                continue;

            if (!RejectedConstructorTypes.Contains(constructedType)) {
                enqueuePodDeclaration(symbol);
                continue;
            }

            yield return CreateRejectedDiagnostic(
                constructedType,
                "ReadOnly scripts may not create Revit transactions; document mutation must use an explicit write mode.",
                sourceName
            );
        }
    }

    private static IEnumerable<ScriptDiagnostic> AnalyzeInvocations(
        SyntaxNode scope,
        SemanticModel semanticModel,
        string sourceName,
        Action<IMethodSymbol> enqueuePodDeclaration
    ) {
        foreach (var invocation in scope.DescendantNodesAndSelf().OfType<InvocationExpressionSyntax>()) {
            foreach (var symbol in ResolveMethodSymbols(semanticModel, invocation)) {
                var originalDefinition = symbol.ReducedFrom ?? symbol;
                var containingType = originalDefinition.ContainingType.ToDisplayString();
                if (IsRejectedMethod(originalDefinition, containingType, out var reason)) {
                    yield return CreateRejectedDiagnostic(
                        $"{containingType}.{originalDefinition.Name}",
                        reason,
                        sourceName
                    );
                    break;
                }

                enqueuePodDeclaration(symbol);
            }
        }
    }

    private static IEnumerable<IMethodSymbol> ResolveMethodSymbols(
        SemanticModel semanticModel,
        InvocationExpressionSyntax invocation
    ) {
        var symbolInfo = semanticModel.GetSymbolInfo(invocation);
        if (symbolInfo.Symbol is IMethodSymbol method)
            yield return method;

        foreach (var candidate in symbolInfo.CandidateSymbols.OfType<IMethodSymbol>())
            yield return candidate;
    }

    private static bool IsRejectedMethod(
        IMethodSymbol symbol,
        string containingType,
        out string reason
    ) {
        if (RejectedMethodsByType.TryGetValue(containingType, out var rejectedMethods) &&
            rejectedMethods.Contains(symbol.Name)) {
            reason = $"ReadOnly scripts may not call {containingType}.{symbol.Name}; this API can dirty an open Revit document.";
            return true;
        }

        if (containingType == "Pe.Revit.Extensions.FamDocument.FamilyDocumentProcessFamily" &&
            symbol.Name == "GetFamilyDocument" &&
            MethodAcceptsRevitFamily(symbol)) {
            reason =
                "ReadOnly scripts may not call GetFamilyDocument(Document, Family); this wrapper opens an editable family document.";
            return true;
        }

        if (containingType == "Autodesk.Revit.DB.ElementTransformUtils" &&
            IsRejectedElementTransform(symbol.Name)) {
            reason = $"ReadOnly scripts may not call {containingType}.{symbol.Name}; element transforms can dirty an open Revit document.";
            return true;
        }

        if (RejectedCreationFactoryTypes.Contains(containingType) &&
            symbol.Name.StartsWith("New", StringComparison.Ordinal)) {
            reason = $"ReadOnly scripts may not call {containingType}.{symbol.Name}; Revit creation factories can dirty an open document.";
            return true;
        }

        reason = string.Empty;
        return false;
    }

    private static bool MethodAcceptsRevitFamily(IMethodSymbol symbol) {
        var originalDefinition = symbol.ReducedFrom ?? symbol;
        return originalDefinition.Parameters.Any(parameter =>
            parameter.Type.ToDisplayString().Equals("Autodesk.Revit.DB.Family", StringComparison.Ordinal));
    }

    private static bool IsRejectedElementTransform(string methodName) =>
        methodName.StartsWith("Copy", StringComparison.Ordinal) ||
        methodName.StartsWith("Mirror", StringComparison.Ordinal) ||
        methodName.StartsWith("Move", StringComparison.Ordinal) ||
        methodName.StartsWith("Rotate", StringComparison.Ordinal);

    private static ScriptDiagnostic CreateRejectedDiagnostic(
        string sourceApi,
        string message,
        string sourceName
    ) => ScriptDiagnosticFactory.Error(
        "policy",
        $"{message} Blocked API: {sourceApi}.",
        sourceName
    );
}
