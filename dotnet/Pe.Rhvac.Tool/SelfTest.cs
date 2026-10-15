using System.Text;
using Newtonsoft.Json.Linq;
using Pe.Shared.Rhvac;

namespace Pe.Rhvac.Tool;

internal static class SelfTest {
    internal static void Run() {
        var passed = 0;
        void Check(bool condition, string name) { if (!condition) throw new InvalidOperationException("Selftest failed: " + name); passed++; }
        byte[] ArrayBytes(ushort type, params byte[] payload) { var bytes = new byte[16 + payload.Length]; BitConverter.GetBytes(0).CopyTo(bytes, 0); BitConverter.GetBytes(type).CopyTo(bytes, 4); BitConverter.GetBytes((ushort)1).CopyTo(bytes, 6); BitConverter.GetBytes(1).CopyTo(bytes, 8); payload.CopyTo(bytes, 16); return bytes; }
        Check((int)ValueCodec.Decode(ArrayBytes(0x2003, BitConverter.GetBytes(42))).Value[0]! == 42, "int32 array");
        Check((string?)ValueCodec.Decode(ArrayBytes(0x2004, BitConverter.GetBytes(float.NaN))).Value[0]?["$number"] == "NaN", "NaN tagged array");
        Check((string?)ValueCodec.Decode(ArrayBytes(0x2008, 1, 0, 0x80)).Value[0] == "€", "CP1252 string array");
        Check((int)ValueCodec.Decode(ArrayBytes(0x200B, 255, 255)).Value[0]! == -1, "VB boolean array");
        Check(ValueCodec.Equal(ValueCodec.Decode(new byte[] { 51, 0xA6, 53 }).Value, ValueCodec.Decode(Encoding.ASCII.GetBytes("3q5")).Value), "both scalar separators");
        Check(ValueCodec.Equal(ValueCodec.Decode(Encoding.ASCII.GetBytes("4qNaN")).Value, ValueCodec.Decode(Encoding.ASCII.GetBytes("4qNaN")).Value), "NaN deterministic equality");
        Check(ValueCodec.Decode(new byte[] { 99 }).Diagnostics.Count == 1 && (string?)ValueCodec.Decode(new byte[] { 99 }).Value["binary"] == "Yw==", "unknown preserves bytes");
        Check(ValueCodec.Decode(ArrayBytes(0x2003, 1)).Diagnostics.Count == 1, "truncated array refuses decode");
        Check(ValueCodec.Decode(null).Value.Type == JTokenType.Null && ValueCodec.Decode(Array.Empty<byte>()).Value is JArray && (string?)ValueCodec.Decode(Encoding.ASCII.GetBytes("8q")).Value[0] == "", "null empty and scalar empty distinct");
        Check((int)ValueCodec.CarryForward(new JArray(2), 8) == 2 && !ValueCodec.Equal(new JArray(2), new JArray(2, 2)), "carry-forward explicit raw difference");
        Check((bool)ValueCodec.ArrayDifference(new JArray(1, 2), new JArray(2, 1))["reorder"]!, "reorder preserves indexes");
        JObject Snapshot(byte source, string name) { var bytes = new[] { source }; var tables = new JObject { ["Room"] = new JObject { ["columns"] = new JArray(), ["rows"] = new JArray(new JObject { ["Number"] = 1, ["Description"] = name }) } }; return new JObject { ["schemaVersion"] = 1, ["source"] = new JObject { ["sha256"] = SnapshotReader.Hash(bytes), ["bytesBase64"] = Convert.ToBase64String(bytes) }, ["tables"] = tables, ["rawTables"] = tables.DeepClone(), ["embedded"] = new JArray(), ["diagnostics"] = new JArray() }; }
        var a = Snapshot(1, "A"); var b = Snapshot(2, "B"); var registry = Comparison.EmptyRegistry();
        var red = Comparison.Compare(a, b, registry);
        Check(((JArray)red["changes"]!).Count == 2 && ((JArray)red["changes"]!).All(c => (string?)c["kind"] == "unpaired"), "red vector Number never pairs");
        var entity = new JObject { ["key"] = "room-stable", ["kind"] = "Room", ["label"] = "Room", ["assignments"] = new JObject { [(string)a["source"]!["sha256"]!] = 1, [(string)b["source"]!["sha256"]!] = 1 } };
        ((JArray)registry["entities"]!).Add(entity);
        Check(((JArray)Comparison.Compare(a, b, registry)["changes"]!).Count == 1, "explicit registry pairs fields");
        ((JArray)registry["entities"]!).Add(entity.DeepClone()); var refused = false;
        try { Comparison.Compare(a, b, registry); } catch (ArgumentException) { refused = true; }
        Check(refused, "duplicate registry fail closed");
        var duplicateSlot = (JObject)entity.DeepClone(); duplicateSlot["key"] = "other"; registry["entities"] = new JArray(entity.DeepClone(), duplicateSlot); refused = false;
        try { Comparison.Compare(a, b, registry); } catch (ArgumentException) { refused = true; }
        Check(refused, "duplicate assignment fail closed");
        registry["entities"] = new JArray(entity.DeepClone()); ((JObject)registry["entities"]![0]!["assignments"]!).Remove((string)b["source"]!["sha256"]!);
        var oneSide = (JArray)Comparison.Compare(a, b, registry)["changes"]!;
        Check(oneSide.All(c => (string?)c["kind"] == "unpaired") && oneSide.Any(c => (string?)c["entityKey"] == "room-stable"), "omitted assignment stays unknown with entity key");
        ((JObject)registry["entities"]![0]!["assignments"]!)[(string)b["source"]!["sha256"]!] = JValue.CreateNull();
        var absent = (JArray)Comparison.Compare(a, b, registry)["changes"]!;
        Check(absent.Any(c => (string?)c["kind"] == "removed" && (string?)c["entityKey"] == "room-stable") && absent.Any(c => (string?)c["kind"] == "unpaired" && c["entityKey"]!.Type == JTokenType.Null), "explicit absent gives removal without consuming unrelated after row");
        var reverse = (JArray)Comparison.Compare(b, a, registry)["changes"]!;
        Check(reverse.Any(c => (string?)c["kind"] == "added" && (string?)c["entityKey"] == "room-stable"), "explicit absent gives addition in reverse");
        ((JObject)registry["entities"]![0]!["assignments"]!)[(string)a["source"]!["sha256"]!] = JValue.CreateNull();
        Check(((JArray)Comparison.Compare(a, b, registry)["changes"]!).All(c => c["entityKey"]!.Type == JTokenType.Null), "both null produce no matched entity");
        var otherKind = (JObject)entity.DeepClone(); otherKind["kind"] = "System"; otherKind["assignments"] = new JObject(); registry["entities"] = new JArray(entity.DeepClone(), otherKind); refused = false;
        try { Comparison.Compare(a, b, registry); } catch (ArgumentException) { refused = true; }
        Check(refused, "entity key globally unique across kinds");
        Console.WriteLine(new JObject { ["selftest"] = "passed", ["assertions"] = passed });
    }
}
