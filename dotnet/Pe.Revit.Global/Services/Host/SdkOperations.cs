using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Serialization;
using Pe.Revit.Loader;
using Pe.Revit.Operations;
using Pe.Revit.Scripting.Transport;
using Pe.Shared.HostContracts.Operations;
using Pe.Shared.HostContracts.Scripting;
using Serilog;
using System.Threading;
using DbDocument = Autodesk.Revit.DB.Document;

namespace Pe.Revit.Global.Services.Host;

/// <summary>
///     Binds product ops into the SDK op catalog (ADR 0009 law 11) so <c>pe-revit op run &lt;key&gt;</c>
///     runs them on the SDK queue under the SDK receipt. Bound at payload startup from handlers this
///     class owns, so they answer whether or not Pe.Host is running; the WebSocket path to Pe.Host
///     keeps its own handlers and is unaffected.
/// </summary>
public static class SdkOperations {
    internal static readonly JsonSerializerSettings Json = new() {
        NullValueHandling = NullValueHandling.Ignore,
        ContractResolver = new DefaultContractResolver {
            NamingStrategy = new CamelCaseNamingStrategy {
                ProcessDictionaryKeys = false,
                OverrideSpecifiedNames = false
            }
        },
        Converters = [new StringEnumConverter()]
    };

    /// <summary>Read-only ops whose handlers complete synchronously on the API thread.</summary>
    private static readonly string[] ReadOnlyKeys = [
        "host.ops.catalog",
        "revit.context.document-session",
        "revit.context.summary",
        "family.look",
        "family.loadTest"
    ];

    /// <summary>
    ///     Binds the read-only ops and <c>scripting.execute</c>. The returned handle owns the scripting
    ///     handler's external event; dispose it at payload shutdown (the SDK disposes the catalog).
    /// </summary>
    public static IDisposable Bind(PeOperationCatalog catalog) {
        Pe.Revit.SettingsRuntime.Json.ValueDomains.SettingsValueDomainBootstrap.RegisterDefaults();
        _ = OpRegistry.RegisterFromLoadedPeAssemblies();
        _ = OpRegistry.Bind(new RevitDataRequestService());
        foreach (var key in ReadOnlyKeys) {
            if (!OpRegistry.TryGet(key, out var op))
                throw new InvalidOperationException($"Product op '{key}' is not registered.");
            catalog.Bind(key, (document, body, ct) => JsonConvert.SerializeObject(
                op.ExecuteAsync(Body(body), Wrap(op.Definition.Needs, document as DbDocument), ct)
                    .GetAwaiter().GetResult(),
                Json));
        }

        // scripting.execute's op method waits for an external event, which cannot fire while the SDK
        // queue holds the API thread; the SDK body runs the script in place instead. The SDK token
        // links into the script's `ct`, so a script that checks it yields to `op cancel`.
        var scripting = new ScriptingBridgeMessageHandler(
            () => RevitUiSession.CurrentUIApplication,
            message => Log.Information("Revit scripting notification: {Message}", message)
        );
        catalog.Bind("scripting.execute", (document, body, ct) => {
            var result = scripting.ExecuteOnApiThread(
                JsonConvert.DeserializeObject<ExecuteRevitScriptRequest>(Body(body), Json)
                ?? throw BridgeOperationExceptions.BadRequest("scripting.execute needs a request body."),
                (RevitDocument)Wrap(OpNeeds.Document, document as DbDocument)!,
                ct);
            // The script service reports a yield as a Cancelled result; the SDK verdict is `cancelled`.
            if (result.Status == ScriptExecutionStatus.Cancelled)
                ct.ThrowIfCancellationRequested();
            return JsonConvert.SerializeObject(result, Json);
        });
        Log.Information("SDK op catalog bound {Count} product operations.", ReadOnlyKeys.Length + 1);
        return scripting;
    }

    /// <summary>The wrapper an op's <see cref="OpNeeds" /> asks for, refused when the document cannot serve it.</summary>
    internal static object? Wrap(OpNeeds needs, DbDocument? document) {
        if (needs == OpNeeds.Nothing)
            return null;
        OpDocumentGate.Require(needs, document != null, document?.IsFamilyDocument == true);
        return needs switch {
            OpNeeds.Document => new RevitDocument(document!),
            OpNeeds.ProjectDocument => new ProjectDocument(document!),
            OpNeeds.FamilyDocument => new FamilyDocument(document!),
            _ => null
        };
    }

    /// <summary>`op run` with no `--body` still names a request; a request-less op reads it as empty.</summary>
    private static string Body(string body) =>
        string.IsNullOrWhiteSpace(body) || body.Trim() == "null" ? "{}" : body;
}
