using Newtonsoft.Json;
using Newtonsoft.Json.Serialization;

namespace Pe.Revit.Takeoff.Rhvac;

// Offline eval scorer for RHVAC takeoffs: compares candidate RhvacRooms against the oracle extract
// of an engineer's calculated .r10 file (extract-rhvac.ps1 output). Pure math, no Revit API.
// Newtonsoft (not System.Text.Json) because SDK analyzer PE1011 forbids STJ in Revit-hosted
// projects; Json.NET binds the camelCase extract onto these records case-insensitively by default.
// This is the INNER eval loop (input-space vs oracle inputs); the OUTER loop — true load recalc —
// requires opening the exported file in RHVAC itself (see README.md, "no headless calculation").

/// <summary>Root of an extract-rhvac.ps1 oracle file. Building/system loads are ignored here.</summary>
public sealed record OracleExtract(string SourceFile, List<OracleRoom> Rooms);

/// <summary>One oracle room: engineer-entered inputs plus RHVAC's stored per-room loads.</summary>
public sealed record OracleRoom(
    int Number,
    string Name,
    double AreaSquareFeet,
    double CeilingHeightFeet,
    OracleLoads Loads,
    List<OracleFloor> Floors,
    List<OracleRoof> Roofs,
    List<OracleWall> Walls,
    List<OracleGlass> Glass,
    List<OracleDoor> Doors
);

/// <summary>Stored RHVAC calculation results used for load-weighting violations.</summary>
public sealed record OracleLoads(double CfmSupplyCooling);

public sealed record OracleFloor(
    string Assembly,
    double UValue,
    double AreaSquareFeet,
    double ExposedPerimeterFeet
);

public sealed record OracleRoof(string Assembly, double UValue, double AreaSquareFeet, double AreaMultiplier);

public sealed record OracleWall(
    int Index1,
    string Assembly,
    double UValue,
    double LengthFeet,
    double HeightFeet,
    int Direction
);

public sealed record OracleGlass(
    string Assembly,
    double UValue,
    double WidthFeet,
    double HeightFeet,
    int WallReference,
    double Shgc,
    int Occurrences
);

public sealed record OracleDoor(
    string Assembly,
    double UValue,
    double WidthFeet,
    double HeightFeet,
    int WallReference
);

/// <summary>
/// Curated room correspondence. Matches pin an oracle room number to a candidate (by Name, or by
/// "R"+Number); skips remove oracle rooms from the pool and the coverage denominator entirely.
/// </summary>
public sealed record RoomMap(List<RoomMapMatch> Matches, List<RoomMapSkip> Skip);

public sealed record RoomMapMatch(int OracleNumber, string Candidate);

public sealed record RoomMapSkip(int OracleNumber, string Reason);

/// <summary>
/// One named tolerance profile. *Pct thresholds compare |candidate-oracle|/oracle*100;
/// CeilingHeightFt is an absolute feet threshold. Gates lists the metrics whose breaches are
/// pass/fail violations; every other breached metric becomes a warning.
/// </summary>
public sealed record ToleranceProfile(
    double AutoMatchAreaPct,
    double RoomAreaPct,
    double RoomAreaMinSqft,
    double CeilingHeightFt,
    double CoverageAreaPctMin,
    double WallDirectionAreaPct,
    double GlassAreaPct,
    double VolumePct,
    double DoorAreaPct,
    double FloorAreaPct,
    double FloorPerimeterPct,
    double RoofAreaPct,
    List<string> Gates
);

/// <summary>
/// One breached metric, path-addressed like RhvacRoomValidator (e.g. "rooms[46].areaSquareFeet",
/// indexed by ORACLE room number). Metric is the gate key ("roomArea", "ceilingHeight", ...) or
/// "categoryMissing" for per-category rollups. Severity is "violation" (gated) or "warning".
/// Delta and Pct are signed candidate-minus-oracle; WeightCfm is the oracle room's stored cooling
/// supply CFM (summed over affected rooms for rollups).
/// </summary>
public sealed record RhvacEvalIssue(
    string Path,
    string Metric,
    string Severity,
    double Candidate,
    double Oracle,
    double Delta,
    double Pct,
    double Threshold,
    double WeightCfm
);

/// <summary>An oracle room no candidate covered, or a candidate no oracle room claimed.</summary>
public sealed record UnmatchedRoom(int Number, string Name, double AreaSquareFeet);

/// <summary>
/// Full scoring result. Pass means zero gated violations (coverage gate included). Only CURATED
/// (explicit-map) matches can gate: provisional area-auto-matches carry no identity evidence, so
/// everything they produce — including their coverage — is diagnostic (warnings), never pass/fail.
/// </summary>
public sealed class Scorecard
{
    public required bool Pass { get; init; }
    public required int MatchedCount { get; init; }
    public required int OracleCount { get; init; }
    public required int CandidateCount { get; init; }
    public required int ProvisionalMatches { get; init; }
    public required double CoverageAreaPct { get; init; }
    public required double CoverageCfmPct { get; init; }
    public required double ProvisionalCoverageAreaPct { get; init; }
    public required double ProvisionalCoverageCfmPct { get; init; }
    public required double CandidateTotalAreaSquareFeet { get; init; }
    public required double OracleTotalAreaSquareFeet { get; init; }
    public required List<UnmatchedRoom> UnmatchedOracle { get; init; }
    public required List<UnmatchedRoom> UnmatchedCandidates { get; init; }
    public required List<RhvacEvalIssue> Violations { get; init; }
    public required List<RhvacEvalIssue> Warnings { get; init; }

    private static readonly JsonSerializerSettings WriteSettings = new() {
        ContractResolver = new CamelCasePropertyNamesContractResolver(),
    };

    public string ToJson() => JsonConvert.SerializeObject(this, Formatting.Indented, WriteSettings);

    /// <summary>Compact human/agent report, capped at ~60 lines, violations first by CFM weight.</summary>
    public string ToText()
    {
        const int maxLines = 60;
        var lines = new List<string> {
            Inv($"RHVAC EVAL {(this.Pass ? "PASS" : "FAIL")}"),
            Inv(
                $"rooms: {this.MatchedCount}/{this.OracleCount} oracle matched ({this.ProvisionalMatches} provisional), {this.CandidateCount} candidates ({this.UnmatchedCandidates.Count} unmatched)"
            ),
            Inv($"coverage (curated, gated): {this.CoverageAreaPct:F1}% area, {this.CoverageCfmPct:F1}% cfm"),
            Inv(
                $"coverage (+provisional, diagnostic): {this.ProvisionalCoverageAreaPct:F1}% area, {this.ProvisionalCoverageCfmPct:F1}% cfm"
            ),
            Inv(
                $"building: candidate {this.CandidateTotalAreaSquareFeet:F0} sf vs oracle rooms {this.OracleTotalAreaSquareFeet:F0} sf"
            ),
        };
        if (this.UnmatchedOracle.Count > 0)
        {
            var shown = this.UnmatchedOracle
                .OrderByDescending(room => room.AreaSquareFeet)
                .Take(5)
                .Select(room => Inv($"{room.Number} {room.Name} ({room.AreaSquareFeet:F0} sf)"));
            var overflow = this.UnmatchedOracle.Count > 5 ? Inv($" +{this.UnmatchedOracle.Count - 5} more") : "";
            lines.Add(Inv($"unmatched oracle: {string.Join(", ", shown)}{overflow}"));
        }

        lines.Add(Inv($"violations: {this.Violations.Count}, warnings: {this.Warnings.Count}"));

        // Per-metric summary: breach count + median signed delta, so systematic bias reads at a
        // glance. Category-missing rollups summarize themselves and are excluded here.
        var byMetric = this.Violations.Concat(this.Warnings)
            .Where(issue => issue.Metric != "categoryMissing")
            .GroupBy(issue => issue.Metric)
            .OrderByDescending(group => group.Count());
        foreach (var group in byMetric)
        {
            var feet = group.Key == "ceilingHeight"; // abs-thresholded metric reports ft, not pct
            var values = group.Select(issue => feet ? issue.Delta : issue.Pct).OrderBy(value => value).ToList();
            var median = values.Count % 2 == 1
                ? values[values.Count / 2]
                : (values[values.Count / 2 - 1] + values[values.Count / 2]) / 2;
            var sameSignShare = (double)values.Count(value => Math.Sign(value) == Math.Sign(median)) / values.Count;
            var bias = median == 0 || sameSignShare < 0.8 ? "mixed"
                : median < 0 ? "systematic undershoot" : "systematic overshoot";
            lines.Add(Inv(
                $"{group.Key}: {group.Count()} breaches, median {median:+0.0;-0.0}{(feet ? " ft" : "%")} ({bias})"
            ));
        }

        var budget = maxLines - lines.Count;
        var issues = this.Violations.Concat(this.Warnings).ToList(); // each list already CFM-desc
        foreach (var issue in issues.Take(budget))
            lines.Add(this.FormatIssue(issue));

        if (issues.Count > budget)
            lines.Add(Inv($"+{issues.Count - budget} more"));

        return string.Join(Environment.NewLine, lines) + Environment.NewLine;
    }

    private string FormatIssue(RhvacEvalIssue issue)
    {
        const string missingPrefix = "categoryMissing.";
        if (issue.Path.StartsWith(missingPrefix, StringComparison.Ordinal))
        {
            var category = issue.Path[missingPrefix.Length..];
            return Inv(
                $"[{issue.Severity}] {issue.Path}: {issue.Candidate:F0}/{this.MatchedCount} matched rooms have no {category} (oracle total {issue.Oracle:F0} sf) cfm {issue.WeightCfm:F0}"
            );
        }

        return Inv(
            $"[{issue.Severity}] {issue.Path}: {issue.Candidate:F2} vs {issue.Oracle:F2} (d {issue.Delta:+0.00;-0.00}, {issue.Pct:+0.0;-0.0}%, threshold {issue.Threshold}) cfm {issue.WeightCfm:F0}"
        );
    }

    private static string Inv(FormattableString text) => FormattableString.Invariant(text);
}

/// <summary>Loads eval fixtures and scores candidate rooms against an oracle extract.</summary>
public static class RhvacEval
{
    private static readonly HashSet<string> KnownGates = new() {
        "coverage", "roomArea", "ceilingHeight", "volume", "wallDirectionArea",
        "glassArea", "doorArea", "floorArea", "floorPerimeter", "roofArea",
    };

    public static OracleExtract LoadOracle(string path)
    {
        var extract = Deserialize<OracleExtract>(path);
        if (extract.Rooms is not { Count: > 0 })
            throw new InvalidDataException($"{path}: oracle extract has no rooms.");
        return extract;
    }

    public static RoomMap LoadMap(string path)
    {
        var map = Deserialize<RoomMap>(path);
        if (map.Matches is null || map.Skip is null)
            throw new InvalidDataException($"{path}: room map needs 'matches' and 'skip' arrays.");
        return map;
    }

    public static ToleranceProfile LoadTolerances(string path, string profileName)
    {
        var file = Deserialize<ToleranceFile>(path);
        if (file.Profiles is null || !file.Profiles.TryGetValue(profileName, out var profile))
            throw new InvalidDataException($"{path}: no tolerance profile '{profileName}'.");
        if (profile.Gates is not { Count: > 0 })
            throw new InvalidDataException($"{path}: profile '{profileName}' has no gates.");
        var unknown = profile.Gates.FirstOrDefault(gate => !KnownGates.Contains(gate));
        if (unknown is not null)
            throw new InvalidDataException($"{path}: profile '{profileName}' has unknown gate '{unknown}'.");
        return profile;
    }

    /// <summary>
    /// Scores candidates against the oracle: explicit map matches first, skips removed, remaining
    /// rooms greedy auto-matched by best area agreement on the same known architectural floor
    /// (provisional, accepted only within AutoMatchAreaPct). Only curated pairs can gate — their
    /// breaches are violations per the profile; provisional pairs always warn (matching by area
    /// and then scoring area is circular, and a wrong identity poisons every per-room metric).
    /// The gated coverage likewise counts curated matches only. All issues CFM-weighted.
    /// </summary>
    public static Scorecard Score(
        IReadOnlyList<RhvacRoom> candidates,
        OracleExtract oracle,
        RoomMap map,
        ToleranceProfile tol
    )
    {
        var skips = map.Skip.Select(skip => skip.OracleNumber).ToHashSet();
        var oracleRooms = oracle.Rooms.Where(room => !skips.Contains(room.Number)).ToList();

        // 1) Explicit map matches — trusted verbatim, never provisional.
        var pairs = new List<(OracleRoom Oracle, RhvacRoom Candidate, bool Provisional)>();
        var usedCandidates = new HashSet<RhvacRoom>();
        var matchedOracle = new HashSet<int>();
        foreach (var match in map.Matches)
        {
            var oracleRoom = oracleRooms.FirstOrDefault(room => room.Number == match.OracleNumber)
                ?? throw new InvalidDataException(
                    $"room map matches oracle room {match.OracleNumber}, which is absent or skipped."
                );
            var candidate = FindCandidate(candidates, match.Candidate)
                ?? throw new InvalidDataException($"room map candidate '{match.Candidate}' not found.");
            if (!matchedOracle.Add(oracleRoom.Number) || !usedCandidates.Add(candidate))
                throw new InvalidDataException($"room map reuses oracle {match.OracleNumber} or '{match.Candidate}'.");
            pairs.Add((oracleRoom, candidate, false));
        }

        // 2) Greedy auto-match by best area agreement. Exact pairs sort first, so a room's own
        // reconstruction always beats a near-area rival; number tie-breaks keep it deterministic.
        // ponytail: O(n^2) pair scan, fine at 150 rooms; blossom matching if projects get huge.
        var candidatePool = candidates.Where(candidate => !usedCandidates.Contains(candidate));
        var proposals =
            from oracleRoom in oracleRooms
             where !matchedOracle.Contains(oracleRoom.Number)
             from candidate in candidatePool
             where LevelsMatch(oracleRoom.Name, candidate.Name)
             let pct = Math.Abs(candidate.AreaSquareFeet - oracleRoom.AreaSquareFeet)
                 / oracleRoom.AreaSquareFeet * 100
            where pct <= tol.AutoMatchAreaPct
            orderby pct, oracleRoom.Number, candidate.Number
            select (oracleRoom, candidate);
        foreach (var (oracleRoom, candidate) in proposals.ToList())
        {
            if (matchedOracle.Contains(oracleRoom.Number) || !usedCandidates.Add(candidate))
                continue;
            matchedOracle.Add(oracleRoom.Number);
            pairs.Add((oracleRoom, candidate, true));
        }

        pairs.Sort((left, right) => left.Oracle.Number.CompareTo(right.Oracle.Number));

        // 3) Per-pair metric comparisons.
        var violations = new List<RhvacEvalIssue>();
        var warnings = new List<RhvacEvalIssue>();

        // Provisional (area-auto-matched) pairs have no identity evidence: a breach against a
        // possibly-wrong room must never gate, so their issues are always warnings.
        var provisionalScope = false;
        void Add(string path, string gate, double cand, double orac, double delta, double pct, double threshold, double cfm)
        {
            var severity = !provisionalScope && tol.Gates.Contains(gate) ? "violation" : "warning";
            var target = severity == "violation" ? violations : warnings;
            target.Add(new RhvacEvalIssue(path, gate, severity, cand, orac, delta, pct, threshold, cfm));
        }

        // Categories entirely absent from a candidate room roll up into ONE issue per category
        // instead of per-room per-bucket noise (a takeoff that produced no walls at all would
        // otherwise drown the report in -100% diffs). The category's configured gate still wins,
        // but rolled-up curated and provisional pairs stay separate so only curated rollups gate.
        var missingByCategory = new Dictionary<(string Category, bool Provisional), (int Rooms, double OracleTotal, double Cfm)>();
        void Missing(string category, double oracleTotal, double cfm)
        {
            var key = (category, provisionalScope);
            var current = missingByCategory.TryGetValue(key, out var value) ? value : default;
            missingByCategory[key] = (current.Rooms + 1, current.OracleTotal + oracleTotal, current.Cfm + cfm);
        }

        // ponytail: 1-unit dead-band on all pct metrics kills float noise on near-zero buckets;
        // roomArea overrides it with the profile's RoomAreaMinSqft.
        void Pct(string path, string gate, double cand, double orac, double thresholdPct, double cfm, double minAbs = 1.0)
        {
            var delta = cand - orac;
            if (Math.Abs(delta) <= minAbs)
                return;
            var pct = orac == 0 ? Math.Sign(delta) * 100.0 : delta / orac * 100;
            if (Math.Abs(pct) <= thresholdPct)
                return;
            Add(path, gate, cand, orac, delta, pct, thresholdPct, cfm);
        }

        void Abs(string path, string gate, double cand, double orac, double thresholdAbs, double cfm)
        {
            var delta = cand - orac;
            if (Math.Abs(delta) <= thresholdAbs)
                return;
            Add(path, gate, cand, orac, delta, orac == 0 ? 0 : delta / orac * 100, thresholdAbs, cfm);
        }

        foreach (var (oracleRoom, candidate, provisional) in pairs)
        {
            provisionalScope = provisional;
            var cfm = oracleRoom.Loads?.CfmSupplyCooling ?? 0;
            var path = $"rooms[{oracleRoom.Number}]";
            Pct($"{path}.areaSquareFeet", "roomArea",
                candidate.AreaSquareFeet, oracleRoom.AreaSquareFeet,
                tol.RoomAreaPct, cfm, tol.RoomAreaMinSqft);
            Abs($"{path}.ceilingHeightFeet", "ceilingHeight",
                candidate.CeilingHeightFeet, oracleRoom.CeilingHeightFeet, tol.CeilingHeightFt, cfm);
            Pct($"{path}.volume", "volume",
                candidate.AreaSquareFeet * candidate.CeilingHeightFeet,
                oracleRoom.AreaSquareFeet * oracleRoom.CeilingHeightFeet,
                tol.VolumePct, cfm);

            var oracBuckets = new double[8];
            foreach (var wall in oracleRoom.Walls)
                oracBuckets[wall.Direction] += wall.LengthFeet * wall.HeightFeet;
            if (candidate.Walls.Count == 0 && oracleRoom.Walls.Count > 0)
            {
                Missing("walls", oracBuckets.Sum(), cfm);
            }
            else
            {
                var candBuckets = new double[8];
                foreach (var wall in candidate.Walls)
                    candBuckets[(int)wall.Direction] += wall.LengthFeet * wall.HeightFeet;
                for (var direction = 0; direction < 8; direction++)
                {
                    var name = ((RhvacWallDirection)direction).ToString();
                    name = char.ToLowerInvariant(name[0]) + name[1..];
                    Pct($"{path}.wallArea.{name}", "wallDirectionArea",
                        candBuckets[direction], oracBuckets[direction], tol.WallDirectionAreaPct, cfm);
                }

                Pct($"{path}.wallArea.total", "wallDirectionArea",
                    candBuckets.Sum(), oracBuckets.Sum(), tol.WallDirectionAreaPct, cfm);
            }

            var oracGlassArea = oracleRoom.Glass.Sum(glass => glass.WidthFeet * glass.HeightFeet * glass.Occurrences);
            if (candidate.Walls.Sum(wall => wall.Windows.Count) == 0 && oracleRoom.Glass.Count > 0)
                Missing("glass", oracGlassArea, cfm);
            else
                Pct($"{path}.glassArea", "glassArea",
                    candidate.Walls.Sum(wall =>
                        wall.Windows.Sum(window => window.WidthFeet * window.HeightFeet * window.Occurrences)),
                    oracGlassArea, tol.GlassAreaPct, cfm);

            var oracDoorArea = oracleRoom.Doors.Sum(door => door.WidthFeet * door.HeightFeet);
            if (candidate.Walls.Sum(wall => wall.Doors.Count) == 0 && oracleRoom.Doors.Count > 0)
                Missing("doors", oracDoorArea, cfm);
            else
                Pct($"{path}.doorArea", "doorArea",
                    candidate.Walls.Sum(wall => wall.Doors.Sum(door => door.WidthFeet * door.HeightFeet)),
                    oracDoorArea, tol.DoorAreaPct, cfm);

            if (candidate.Floors.Count == 0 && oracleRoom.Floors.Count > 0)
            {
                Missing("floors", oracleRoom.Floors.Sum(floor => floor.AreaSquareFeet), cfm);
            }
            else
            {
                Pct($"{path}.floorArea", "floorArea",
                    candidate.Floors.Sum(floor => floor.AreaSquareFeet),
                    oracleRoom.Floors.Sum(floor => floor.AreaSquareFeet),
                    tol.FloorAreaPct, cfm);
                Pct($"{path}.floorExposedPerimeter", "floorPerimeter",
                    candidate.Floors.Sum(floor => floor.ExposedPerimeterFeet),
                    oracleRoom.Floors.Sum(floor => floor.ExposedPerimeterFeet),
                    tol.FloorPerimeterPct, cfm);
            }

            if (candidate.Roofs.Count == 0 && oracleRoom.Roofs.Count > 0)
                Missing("roofs", oracleRoom.Roofs.Sum(roof => roof.AreaSquareFeet), cfm);
            else
                Pct($"{path}.roofArea", "roofArea",
                    candidate.Roofs.Sum(roof => roof.AreaSquareFeet),
                    oracleRoom.Roofs.Sum(roof => roof.AreaSquareFeet),
                    tol.RoofAreaPct, cfm);
        }

        foreach (var category in new[] { "walls", "glass", "doors", "floors", "roofs" })
        {
            foreach (var provisional in new[] { false, true })
            {
                if (!missingByCategory.TryGetValue((category, provisional), out var missing))
                    continue;
                var (gate, threshold) = category switch {
                    "walls" => ("wallDirectionArea", tol.WallDirectionAreaPct),
                    "glass" => ("glassArea", tol.GlassAreaPct),
                    "doors" => ("doorArea", tol.DoorAreaPct),
                    "floors" => ("floorArea", tol.FloorAreaPct),
                    "roofs" => ("roofArea", tol.RoofAreaPct),
                    _ => throw new InvalidOperationException($"Unknown category '{category}'."),
                };
                provisionalScope = provisional;
                Add(
                    $"categoryMissing.{category}", gate,
                    missing.Rooms, missing.OracleTotal, -missing.OracleTotal, -100, threshold, missing.Cfm
                );
            }
        }

        provisionalScope = false;

        // 4) Coverage and rollups. The gated coverage counts CURATED matches only: provisional
        // area-collisions are not evidence a room was found (matching by area then crediting area
        // is circular), so their contribution is reported separately and never gates.
        var totalOracleArea = oracleRooms.Sum(room => room.AreaSquareFeet);
        var totalOracleCfm = oracleRooms.Sum(room => room.Loads?.CfmSupplyCooling ?? 0);
        var curated = pairs.Where(pair => !pair.Provisional).ToList();
        var matchedArea = curated.Sum(pair => pair.Oracle.AreaSquareFeet);
        var matchedCfm = curated.Sum(pair => pair.Oracle.Loads?.CfmSupplyCooling ?? 0);
        var coverageAreaPct = totalOracleArea == 0 ? 100 : matchedArea / totalOracleArea * 100;
        var coverageCfmPct = totalOracleCfm == 0 ? 100 : matchedCfm / totalOracleCfm * 100;
        var provisionalArea = pairs.Sum(pair => pair.Oracle.AreaSquareFeet);
        var provisionalCfm = pairs.Sum(pair => pair.Oracle.Loads?.CfmSupplyCooling ?? 0);
        var provisionalCoverageAreaPct = totalOracleArea == 0 ? 100 : provisionalArea / totalOracleArea * 100;
        var provisionalCoverageCfmPct = totalOracleCfm == 0 ? 100 : provisionalCfm / totalOracleCfm * 100;
        if (coverageAreaPct < tol.CoverageAreaPctMin)
        {
            Add("coverage.areaPct", "coverage",
                coverageAreaPct, 100, coverageAreaPct - 100, coverageAreaPct - 100,
                tol.CoverageAreaPctMin, totalOracleCfm - matchedCfm);
        }

        var unmatchedOracle = oracleRooms
            .Where(room => !matchedOracle.Contains(room.Number))
            .Select(room => new UnmatchedRoom(room.Number, room.Name, room.AreaSquareFeet))
            .ToList();
        var unmatchedCandidates = candidates
            .Where(candidate => !usedCandidates.Contains(candidate))
            .Select(candidate => new UnmatchedRoom(candidate.Number, candidate.Name, candidate.AreaSquareFeet))
            .ToList();

        return new Scorecard {
            Pass = violations.Count == 0,
            MatchedCount = pairs.Count,
            OracleCount = oracleRooms.Count,
            CandidateCount = candidates.Count,
            ProvisionalMatches = pairs.Count(pair => pair.Provisional),
            CoverageAreaPct = coverageAreaPct,
            CoverageCfmPct = coverageCfmPct,
            ProvisionalCoverageAreaPct = provisionalCoverageAreaPct,
            ProvisionalCoverageCfmPct = provisionalCoverageCfmPct,
            CandidateTotalAreaSquareFeet = candidates.Sum(candidate => candidate.AreaSquareFeet),
            OracleTotalAreaSquareFeet = totalOracleArea,
            UnmatchedOracle = unmatchedOracle,
            UnmatchedCandidates = unmatchedCandidates,
            Violations = violations.OrderByDescending(issue => issue.WeightCfm).ToList(),
            Warnings = warnings.OrderByDescending(issue => issue.WeightCfm).ToList(),
        };
    }

    private static bool LevelsMatch(string oracleName, string candidateName)
    {
        var oracle = System.Text.RegularExpressions.Regex.Match(
            oracleName,
            @"(?<!\d)([0-3])\d{2}(?!\d)"
        );
        var candidate = System.Text.RegularExpressions.Regex.Match(
            candidateName,
            @"^Level\s+([0-3])(?:\D|$)"
        );
        return !oracle.Success || !candidate.Success || oracle.Groups[1].Value == candidate.Groups[1].Value;
    }

    private static RhvacRoom? FindCandidate(IReadOnlyList<RhvacRoom> candidates, string key)
    {
        var byName = candidates.FirstOrDefault(candidate => candidate.Name == key);
        if (byName is not null)
            return byName;
        if (key.Length > 1 && key[0] == 'R'
            && int.TryParse(key[1..], NumberStyles.None, CultureInfo.InvariantCulture, out var number))
            return candidates.FirstOrDefault(candidate => candidate.Number == number);
        return null;
    }

    private static T Deserialize<T>(string path)
    {
        var json = File.ReadAllText(path); // throws if missing — fail fast
        return JsonConvert.DeserializeObject<T>(json)
            ?? throw new InvalidDataException($"{path}: deserialized to null.");
    }

    private sealed record ToleranceFile(Dictionary<string, ToleranceProfile> Profiles);
}
