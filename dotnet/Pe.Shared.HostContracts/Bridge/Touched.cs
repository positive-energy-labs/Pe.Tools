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
    [EnumMember(Value = "posted-command")] PostedCommand,
    /// <summary>A commit landed while another call's window was open, so it cannot be pinned on this call or cleared from it.</summary>
    [EnumMember(Value = "overlapped")] Overlapped
}

/// <summary>
///     What one op call did to the document, as the scope and the change monitor saw it. Never set by an op.
///     The TS twin is <c>touchedSchema</c> in agent-contracts <c>action-receipts.ts</c>; both assert
///     <c>receipt-response.fixture.json</c>. <c>Kind</c> is the wire discriminator.
/// </summary>
[JsonConverter(typeof(TouchedConverter))]
public abstract record Touched {
    private Touched() { }
    public abstract string Kind { get; }

    private static int Count(int value) =>
        value >= 0 ? value : throw new ArgumentOutOfRangeException(nameof(value), value, "A change count is never negative.");

    public sealed record None : Touched {
        public override string Kind => "none";
    }

    public sealed record RolledBack : Touched {
        public override string Kind => "rolledBack";
    }

    public sealed record Restored(List<ViewRef> Views) : Touched {
        public override string Kind => "restored";
    }

    public sealed record RestoreFailed : Touched {
        public RestoreFailed(List<ViewLeft> views) =>
            this.Views = views.Count != 0 ? views : throw new ArgumentException("restoreFailed names at least one view.", nameof(views));

        public List<ViewLeft> Views { get; }
        public override string Kind => "restoreFailed";
    }

    public sealed record Wrote(List<string> Transactions, int Added, int Modified, int Deleted) : Touched {
        public int Added { get; } = Count(Added);
        public int Modified { get; } = Count(Modified);
        public int Deleted { get; } = Count(Deleted);
        public override string Kind => "wrote";
    }

    /// <summary>A commit the op's scope did not allow. The call fails; the runner does not roll it back.</summary>
    public sealed record Unauthorized(List<string> Transactions, int Added, int Modified, int Deleted) : Touched {
        public int Added { get; } = Count(Added);
        public int Modified { get; } = Count(Modified);
        public int Deleted { get; } = Count(Deleted);
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
public sealed record OpReceiptResponse {
    private OpReceiptResponse(Touched touched) => this.Touched = touched;

    public JRaw? Payload { get; private init; }
    public Touched Touched { get; }
    public JRaw? Evidence { get; private init; }
    public string? Error { get; private init; }
    public int? StatusCode { get; private init; }
    public string? Outcome { get; private init; }

    /// <summary>A success always writes its <c>payload</c> key, as JSON <c>null</c> when the op returned nothing.</summary>
    public static OpReceiptResponse Ok(JRaw? payload, Touched touched, JRaw? evidence = null) =>
        (touched ?? throw new ArgumentNullException(nameof(touched))) is Touched.Unauthorized
            ? throw new ArgumentException("A success cannot carry touched: unauthorized; that call fails.", nameof(touched))
            : new OpReceiptResponse(touched) { Payload = payload ?? new JRaw("null"), Evidence = evidence };

    public static OpReceiptResponse Failed(string error, int statusCode, Touched touched, string? outcome = null) =>
        new(touched ?? throw new ArgumentNullException(nameof(touched))) {
            Error = error ?? throw new ArgumentNullException(nameof(error)), StatusCode = statusCode, Outcome = outcome
        };

    // The bytes are the contract, so the shape serializes itself and no caller's settings can change them.
    private static readonly JsonSerializerSettings Json = new() {
        NullValueHandling = NullValueHandling.Ignore,
        ContractResolver = new DefaultContractResolver { NamingStrategy = new CamelCaseNamingStrategy() }
    };

    public string ToJson() => JsonConvert.SerializeObject(this, Json);
}

/// <summary>
///     Reads a <see cref="Touched" /> by its <c>kind</c>; a bridge frame carries one back to a C# reader.
///     Writing stays the default, which emits <c>Kind</c> with the case's own members.
/// </summary>
public sealed class TouchedConverter : JsonConverter<Touched> {
    public override bool CanWrite => false;

    public override void WriteJson(JsonWriter writer, Touched? value, JsonSerializer serializer) =>
        throw new NotSupportedException();

    public override Touched? ReadJson(JsonReader reader, Type objectType, Touched? existingValue, bool hasExistingValue,
        JsonSerializer serializer) {
        if (reader.TokenType == JsonToken.Null) return null;
        var json = JObject.Load(reader);
        T Get<T>(string name) =>
            (json.GetValue(name, StringComparison.OrdinalIgnoreCase)
             ?? throw new JsonSerializationException($"touched is missing '{name}'")).ToObject<T>(serializer)!;
        var kind = Get<string>("kind");
        return kind switch {
            "none" => new Touched.None(),
            "rolledBack" => new Touched.RolledBack(),
            "restored" => new Touched.Restored(Get<List<ViewRef>>("views")),
            "restoreFailed" => new Touched.RestoreFailed(Get<List<ViewLeft>>("views")),
            "wrote" => new Touched.Wrote(Get<List<string>>("transactions"), Get<int>("added"), Get<int>("modified"), Get<int>("deleted")),
            "unauthorized" => new Touched.Unauthorized(Get<List<string>>("transactions"), Get<int>("added"), Get<int>("modified"), Get<int>("deleted")),
            "unknown" => new Touched.Unknown(Get<TouchedUnknownReason>("reason")),
            _ => throw new JsonSerializationException($"Unknown touched kind '{kind}'")
        };
    }
}
