using System.Runtime.Serialization;
using Newtonsoft.Json;
using Newtonsoft.Json.Converters;
using Newtonsoft.Json.Linq;
using Newtonsoft.Json.Serialization;

namespace Pe.Shared.HostContracts.Bridge;

/// <summary>A view is named with its document: an op can touch more than one.</summary>
public sealed record ViewRef(string DocumentKey, string UniqueId, long Id);

[JsonConverter(typeof(StringEnumConverter))]
public enum ViewLeftover {
    [EnumMember(Value = "crop")] Crop,
    [EnumMember(Value = "scopeBox")] ScopeBox,
    [EnumMember(Value = "annotationCrop")] AnnotationCrop,
    [EnumMember(Value = "sheetFilter")] SheetFilter
}

/// <summary>A view a failed restore left changed, and which of its temporaries are still set.</summary>
public sealed record ViewLeft(ViewRef View, List<ViewLeftover> Left);

[JsonConverter(typeof(StringEnumConverter))]
public enum TouchedUnknownReason {
    [EnumMember(Value = "lost-response")] LostResponse,
    [EnumMember(Value = "cancelled-mid-effect")] CancelledMidEffect,
    [EnumMember(Value = "process-exit")] ProcessExit,
    [EnumMember(Value = "posted-command")] PostedCommand
}

/// <summary>
///     What one op call did to the document, as the scope and the change monitor saw it. Never set by an op.
///     The TS twin is <c>touchedSchema</c> in agent-contracts <c>action-receipts.ts</c>; both assert
///     <c>receipt-response.fixture.json</c>. <c>Kind</c> is the wire discriminator.
/// </summary>
// ponytail: write-only in C#. The bridge sends this and the host reads it; add a JsonConverter keyed on
// `kind` when a C# reader exists.
public abstract record Touched {
    private Touched() { }
    public abstract string Kind { get; }

    public sealed record None : Touched {
        public override string Kind => "none";
    }

    public sealed record RolledBack : Touched {
        public override string Kind => "rolledBack";
    }

    public sealed record Restored(List<ViewRef> Views) : Touched {
        public override string Kind => "restored";
    }

    public sealed record RestoreFailed(List<ViewLeft> Views) : Touched {
        public override string Kind => "restoreFailed";
    }

    public sealed record Wrote(List<string> Transactions, int Added, int Modified, int Deleted) : Touched {
        public override string Kind => "wrote";
    }

    /// <summary>A commit the op's scope did not allow. The call fails; the runner does not roll it back.</summary>
    public sealed record Unauthorized(List<string> Transactions, int Added, int Modified, int Deleted) : Touched {
        public override string Kind => "unauthorized";
    }

    public sealed record Unknown(TouchedUnknownReason Reason) : Touched {
        public override string Kind => "unknown";
    }
}

/// <summary>
///     The one object <c>BridgeAgent</c> writes to an op receipt's response file, which <c>pe-revit op result</c>
///     returns as <c>response</c> and the host's <c>native-receipts.ts</c> reads after a lost socket. It replaces
///     the bare payload (success) and the bare <c>{error, statusCode, outcome}</c> (failure).
///     A success has <c>Payload</c> and no <c>Error</c>; a failure has <c>Error</c> and no <c>Payload</c>. Both carry
///     <c>Touched</c>: a failed or cancelled call may still have written. <c>Evidence</c> is the response's
///     <c>IEvidenced&lt;T&gt;.Evidence</c>, absent when the response type declares none. The verdict stays on the
///     SDK receipt and is not repeated here.
/// </summary>
public sealed record OpReceiptResponse(
    JRaw? Payload,
    Touched Touched,
    JRaw? Evidence = null,
    string? Error = null,
    int? StatusCode = null,
    string? Outcome = null
) {
    // The bytes are the contract, so the shape serializes itself and no caller's settings can change them.
    private static readonly JsonSerializerSettings Json = new() {
        NullValueHandling = NullValueHandling.Ignore,
        ContractResolver = new DefaultContractResolver { NamingStrategy = new CamelCaseNamingStrategy() }
    };

    public string ToJson() => JsonConvert.SerializeObject(this, Json);
}
