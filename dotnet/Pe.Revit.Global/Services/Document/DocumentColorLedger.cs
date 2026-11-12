using Pe.Revit.Extensions.ProjDocument;
using Pe.Shared.StorageRuntime;
using Pe.Shared.StorageRuntime.Json;
using Newtonsoft.Json;
using System.Windows.Media;
using WpfColor = System.Windows.Media.Color;

namespace Pe.Revit.Global.Services.Document;

/// <summary>
///     Single source of truth for per-document UI color. Every document gets a color slot assigned
///     on first sight and keeps it forever — persisted per-user, keyed by the stable document key
///     (cloud GUIDs / path). Palette item colors and Revit tab coloring both derive from here;
///     nothing reads colors back out of Revit's UI anymore.
///     Slots are the web design language's categorical palette (--cat-* in apps/web/src/styles.css).
/// </summary>
public static class DocumentColorLedger {
    // Palette order is assignment order; ledger stores slot names so hue values can evolve
    // without re-keying every document. Hues are pastelled (blended toward white) so a
    // whole-tab fill stays readable under Revit's dark tab text.
    private static readonly (string Slot, WpfColor Color)[] Palette = [
        ("blue", Pastel(0x00, 0x56, 0x95)),
        ("green", Pastel(0x2F, 0x6A, 0x4A)),
        ("slate", Pastel(0x4F, 0x64, 0x73)),
        ("lichen", Pastel(0x6C, 0x7A, 0x4F)),
        ("clay", Pastel(0x8A, 0x5E, 0x3B)),
        ("kiln", Pastel(0x84, 0x7A, 0x67))
    ];

    private static WpfColor Pastel(byte r, byte g, byte b) {
        const double towardWhite = 0.4;
        return WpfColor.FromRgb(Lift(r), Lift(g), Lift(b));

        static byte Lift(byte channel) => (byte)(channel + ((255 - channel) * towardWhite));
    }

    private static readonly JsonReader<DocumentColorLedgerData> File =
        StorageClient.Default.Global().State().Json<DocumentColorLedgerData>("document-colors");

    private static DocumentColorLedgerData? _data;
    private static bool _kept;

    private static DocumentColorLedgerData Data {
        get {
            if (_data != null) return _data;
            _data = ReadData(File.FilePath);
            _kept = _data == null && System.IO.File.Exists(File.FilePath);
            _data ??= new DocumentColorLedgerData();

            return _data;
        }
    }

    internal static DocumentColorLedgerData? ReadData(string path) =>
        StoredFile.Read(path, StoredPolicy.Keep, "Document colors", text => {
            var data = JsonConvert.DeserializeObject<DocumentColorLedgerData>(text);
            return data is { SchemaVersion: 1, Assignments: not null } ? data
                : throw new InvalidDataException("Invalid document color ledger");
        });

    /// <summary>Whether Revit's view tabs are painted with ledger colors. Persisted.</summary>
    public static bool TabColoringEnabled {
        get => Data.TabColoringEnabled;
        set {
            Data.TabColoringEnabled = value;
            Save();
        }
    }

    /// <summary>Whole-tab background fill vs top bar only. Persisted.</summary>
    public static bool WholeTabFill {
        get => Data.WholeTabFill;
        set {
            Data.WholeTabFill = value;
            Save();
        }
    }

    /// <summary>The document's forever-color, assigning and persisting a slot on first sight.</summary>
    public static WpfColor GetColor(Autodesk.Revit.DB.Document? document) {
        if (document == null || !document.IsValidObject) return Colors.Gray;

        var key = document.GetDocumentKey();
        if (Data.Assignments.TryGetValue(key, out var slot)) {
            foreach (var entry in Palette) {
                if (entry.Slot == slot)
                    return entry.Color;
            }
        }

        var assigned = LeastUsedSlot();
        Data.Assignments[key] = assigned.Slot;
        Save();
        return assigned.Color;
    }

    private static (string Slot, WpfColor Color) LeastUsedSlot() {
        var best = Palette[0];
        var bestCount = int.MaxValue;
        foreach (var entry in Palette) {
            var count = Data.Assignments.Values.Count(s => s == entry.Slot);
            if (count >= bestCount) continue;
            best = entry;
            bestCount = count;
        }

        return best;
    }

    private static void Save() {
        if (_kept) return; // Authored preferences that cannot decode must never be overwritten.
        try {
            StoredFile.WriteAtomic(File.FilePath, System.Text.Encoding.UTF8.GetBytes(JsonConvert.SerializeObject(Data)), overwrite: true);
        } catch (Exception exception) {
            StoredFile.Note(File.FilePath, StoredPolicy.Keep, "Document colors", exception);
        }
    }
}

/// <summary>Persisted shape of the ledger (state/document-colors.json).</summary>
public sealed class DocumentColorLedgerData {
    public int SchemaVersion { get; set; } = 1;
    public bool TabColoringEnabled { get; set; } = true;
    public bool WholeTabFill { get; set; }
    public Dictionary<string, string> Assignments { get; set; } = [];
}
