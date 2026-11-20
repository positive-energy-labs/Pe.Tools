using System.Text.RegularExpressions;
using NUnit.Framework;

namespace Pe.Takeoff.Tests;

// FOOTGUN: a carrier GUID reused across libraries reads as "bound" through Project Information and
// never lands on Filled Regions. Rooms 2026-09-24: PE_M___RoomName shared ...9006 with
// Pe.Revit.Partition's EnclosureGuid, so the binder skipped it and rooms.draw threw. The scan is
// textual because the carrier classes' static constructors load RevitAPI.
public sealed class CarrierGuidTests
{
    private static readonly Regex Literal = new(@"""(b7e0c1d4-51aa-4a01-9f4e-[0-9a-f]{12})""", RegexOptions.IgnoreCase);

    [Test]
    public void Every_carrier_guid_literal_is_declared_once_across_dotnet()
    {
        var dir = new DirectoryInfo(TestContext.CurrentContext.TestDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "Pe.Tools.slnx"))) dir = dir.Parent;
        Assert.That(dir, Is.Not.Null, "Pe.Tools.slnx not found above the test directory");
        var owners = new Dictionary<string, List<string>>(StringComparer.OrdinalIgnoreCase);
        foreach (var file in Directory.EnumerateFiles(Path.Combine(dir!.FullName, "dotnet"), "*.cs", SearchOption.AllDirectories))
        {
            if (file.Contains($"{Path.DirectorySeparatorChar}obj{Path.DirectorySeparatorChar}") || file.EndsWith("CarrierGuidTests.cs")) continue;
            foreach (Match m in Literal.Matches(File.ReadAllText(file)))
                (owners.TryGetValue(m.Groups[1].Value, out var list) ? list : owners[m.Groups[1].Value] = []).Add(Path.GetRelativePath(dir.FullName, file));
        }
        Assert.That(owners, Is.Not.Empty);
        var duplicates = owners.Where(o => o.Value.Distinct().Count() > 1)
            .Select(o => $"{o.Key}: {string.Join(", ", o.Value.Distinct())}").ToList();
        Assert.That(duplicates, Is.Empty, string.Join("\n", duplicates));
    }
}
