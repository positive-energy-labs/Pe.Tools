using Newtonsoft.Json.Linq;

namespace Pe.Shared.Rhvac;

public static class Comparison {
    public static JObject EmptyRegistry() => new JObject { ["schemaVersion"] = 1, ["entities"] = new JArray() };
    public static void ValidateRegistry(JObject registry, params JObject[] snapshots) {
        if ((int?)registry["schemaVersion"] != 1 || registry["entities"] is not JArray entities) throw new ArgumentException("Registry schemaVersion 1 and entities array required.");
        var keys = new HashSet<string>(StringComparer.Ordinal); var slots = new HashSet<string>(StringComparer.Ordinal);
        foreach (var entity in entities.OfType<JObject>()) {
            var key = (string?)entity["key"]; var kind = (string?)entity["kind"];
            if (string.IsNullOrWhiteSpace(key) || kind != "Room" && kind != "System" || entity["label"]?.Type != JTokenType.String || entity["assignments"] is not JObject assignments)
                throw new ArgumentException("Each registry entity requires key, Room/System kind, label and assignments.");
            if (!keys.Add(key!)) throw new ArgumentException("Duplicate registry entity key: " + key);
            foreach (var assignment in assignments.Properties()) {
                if (assignment.Value.Type != JTokenType.Integer && assignment.Value.Type != JTokenType.Null || assignment.Name.Length != 64 || assignment.Name.Any(c => !Uri.IsHexDigit(c))) throw new ArgumentException("Assignments require SHA256 keys and integer Number or explicit null values.");
                if (assignment.Value.Type == JTokenType.Null) continue;
                var number = (int)assignment.Value;
                if (!slots.Add(assignment.Name + "\0" + kind + "\0" + number)) throw new ArgumentException("A source/table/Number is assigned more than once.");
                foreach (var snapshot in snapshots.Where(s => (string?)s["source"]?["sha256"] == assignment.Name)) {
                    var rows = Rows(snapshot["tables"]?[kind]);
                    if (rows.Count(r => (int?)r["Number"] == number) != 1) throw new ArgumentException("Registry assignment does not identify exactly one record: " + kind + " " + number);
                }
            }
        }
        if (entities.Any(e => e is not JObject)) throw new ArgumentException("Registry entities must be objects.");
    }
    public static void ValidateSnapshot(JObject snapshot) {
        if ((int?)snapshot["schemaVersion"] != 1 || snapshot["source"] is not JObject source || snapshot["tables"] is not JObject || snapshot["rawTables"] is not JObject || snapshot["embedded"] is not JArray || snapshot["diagnostics"] is not JArray)
            throw new ArgumentException("Complete schemaVersion 1 snapshot required.");
        var bytes = Convert.FromBase64String((string?)source["bytesBase64"] ?? throw new ArgumentException("Source bytes required."));
        if (bytes.Length > SnapshotReader.MaxSourceBytes || SnapshotReader.Hash(bytes) != (string?)source["sha256"]) throw new ArgumentException("Snapshot source SHA256 does not match bytes.");
        foreach (var kind in new[] { "Room", "System" }) {
            var rows = Rows(snapshot["tables"]?[kind]); var numbers = new HashSet<int>();
            foreach (var row in rows) if (row["Number"]?.Type != JTokenType.Integer || !numbers.Add((int)row["Number"]!)) throw new ArgumentException("Duplicate or invalid Number in " + kind + ".");
        }
    }
    private static List<JObject> Rows(JToken? table) => table?["rows"] is JArray rows ? rows.Cast<JObject>().ToList() : new List<JObject>();
    private static JToken Missing() => new JObject { ["absent"] = true };
    public static JObject Compare(JObject before, JObject after, JObject registry) {
        ValidateSnapshot(before); ValidateSnapshot(after); ValidateRegistry(registry, before, after);
        var changes = new JArray(); var diagnostics = new JArray();
        var aSha = (string)before["source"]!["sha256"]!; var bSha = (string)after["source"]!["sha256"]!;
        void Add(string? key, string kind, string table, int? aNumber, int? bNumber, string field, JToken? a, JToken? b, string? embeddedTable = null) {
            var change = new JObject { ["entityKey"] = key == null ? JValue.CreateNull() : new JValue(key), ["kind"] = kind, ["table"] = table, ["beforeNumber"] = aNumber.HasValue ? new JValue(aNumber.Value) : JValue.CreateNull(), ["afterNumber"] = bNumber.HasValue ? new JValue(bNumber.Value) : JValue.CreateNull(),
                ["field"] = field, ["before"] = a?.DeepClone() ?? Missing(), ["after"] = b?.DeepClone() ?? Missing() };
            if (embeddedTable != null) change["embeddedTable"] = embeddedTable;
            changes.Add(change);
        }
        void Fields(string? key, string table, JObject a, JObject b, int? an, int? bn, JObject? rawA, JObject? rawB, string? nested = null) {
            foreach (var field in a.Properties().Select(p => p.Name).Union(b.Properties().Select(p => p.Name), StringComparer.Ordinal).OrderBy(x => x, StringComparer.Ordinal)) {
                var av = a[field]; var bv = b[field];
                var kind = field == "Identifier" ? "identity" : table == "Results" || nested == "Results" || nested?.EndsWith("/Results", StringComparison.Ordinal) == true || field.StartsWith("Calculated", StringComparison.Ordinal) || field.StartsWith("CFMSupply", StringComparison.Ordinal) || field == "RegistersCalculated" ? "result"
                    : av is JObject ab && ab["binary"] != null || bv is JObject bb && bb["binary"] != null ? "storage" : "value";
                if (!ValueCodec.Equal(av, bv)) Add(key, kind, table, an, bn, field, av, bv, nested);
                else if (rawA != null && rawB != null && !ValueCodec.Equal(rawA[field], rawB[field])) Add(key, "storage", table, an, bn, field, rawA[field], rawB[field], nested);
            }
        }
        void Tables(JObject at, JObject bt, JObject? ar, JObject? br, string? key, int? an, int? bn, string? owner, string? embeddedColumn = null) {
            foreach (var table in at.Properties().Select(p => p.Name).Union(bt.Properties().Select(p => p.Name), StringComparer.Ordinal).OrderBy(x => x, StringComparer.Ordinal)) {
                var a = Rows(at[table]); var b = Rows(bt[table]); var ac = at[table]?["columns"]; var bc = bt[table]?["columns"];
                var top = owner ?? table; var nested = owner == null ? null : embeddedColumn + "/" + table;
                if (!ValueCodec.Equal(ac, bc)) Add(key, "schema", top, an, bn, "(columns)", ac, bc, nested);
                if (owner == null && (table == "Room" || table == "System")) continue;
                if (a.Count == 1 && b.Count == 1) Fields(key, top, a[0], b[0], an, bn, Rows(ar?[table]).FirstOrDefault(), Rows(br?[table]).FirstOrDefault(), nested);
                else {
                    foreach (var row in a) Add(key, b.Count == 0 ? "removed" : "unpaired", top, an, bn, "(record)", row, null, nested);
                    foreach (var row in b) Add(key, a.Count == 0 ? "added" : "unpaired", top, an, bn, "(record)", null, row, nested);
                    if (a.Count > 0 && b.Count > 0) diagnostics.Add(ValueCodec.Diagnostic("unpaired-table", "No identity rule for multi-row table " + (owner == null ? table : owner + "/" + table) + "."));
                }
            }
        }
        Tables((JObject)before["tables"]!, (JObject)after["tables"]!, (JObject)before["rawTables"]!, (JObject)after["rawTables"]!, null, null, null, null);
        foreach (var table in new[] { "Room", "System" }) {
            var aRows = Rows(before["tables"]![table]); var bRows = Rows(after["tables"]![table]); var usedA = new HashSet<int>(); var usedB = new HashSet<int>();
            foreach (var entity in ((JArray)registry["entities"]!).OfType<JObject>().Where(e => (string?)e["kind"] == table)) {
                var assignments = (JObject)entity["assignments"]!; var an = (int?)assignments[aSha]; var bn = (int?)assignments[bSha]; var key = (string)entity["key"]!;
                var a = an.HasValue ? aRows.Single(r => (int?)r["Number"] == an) : null; var b = bn.HasValue ? bRows.Single(r => (int?)r["Number"] == bn) : null;
                if (an.HasValue) usedA.Add(an.Value); if (bn.HasValue) usedB.Add(bn.Value);
                if (a == null && b == null) continue;
                if (a == null || b == null) {
                    var unknown = a == null ? assignments.Property(aSha, StringComparison.Ordinal) == null : assignments.Property(bSha, StringComparison.Ordinal) == null;
                    Add(key, unknown ? "unpaired" : a == null ? "added" : "removed", table, an, bn, "(record)", a, b);
                    continue;
                }
                else Fields(key, table, a, b, an, bn, Rows(before["rawTables"]![table]).Single(r => (int?)r["Number"] == an), Rows(after["rawTables"]![table]).Single(r => (int?)r["Number"] == bn));
                var ae = ((JArray)before["embedded"]!).OfType<JObject>().Where(e => (string?)e["table"] == table && (int?)e["recordNumber"] == an).ToList();
                var be = ((JArray)after["embedded"]!).OfType<JObject>().Where(e => (string?)e["table"] == table && (int?)e["recordNumber"] == bn).ToList();
                foreach (var column in ae.Select(e => (string)e["column"]!).Union(be.Select(e => (string)e["column"]!), StringComparer.Ordinal)) {
                    var av = ae.SingleOrDefault(e => (string?)e["column"] == column); var bv = be.SingleOrDefault(e => (string?)e["column"] == column);
                    Tables((JObject?)av?["tables"] ?? new JObject(), (JObject?)bv?["tables"] ?? new JObject(), null, null, key, an, bn, table, column);
                }
            }
            foreach (var row in aRows.Where(r => !usedA.Contains((int)r["Number"]!))) Add(null, "unpaired", table, (int)row["Number"]!, null, "(record)", row, null);
            foreach (var row in bRows.Where(r => !usedB.Contains((int)r["Number"]!))) Add(null, "unpaired", table, null, (int)row["Number"]!, "(record)", null, row);
        }
        foreach (var d in ((JArray)before["diagnostics"]!).Concat((JArray)after["diagnostics"]!)) diagnostics.Add(d.DeepClone());
        return new JObject { ["schemaVersion"] = 1, ["beforeSha256"] = aSha, ["afterSha256"] = bSha, ["registry"] = registry.DeepClone(), ["changes"] = changes, ["diagnostics"] = diagnostics };
    }
}
