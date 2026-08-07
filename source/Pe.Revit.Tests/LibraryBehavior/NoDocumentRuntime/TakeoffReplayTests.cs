using Pe.Revit.Takeoff;

namespace Pe.Revit.Tests.LibraryBehavior.NoDocumentRuntime;

// The offline detection loop: DetectSnapshot persists exactly what Detector.Detect consumes
// (heightfield + composed seed ink + level identity); Replay reruns partition detection +
// polygonization with arbitrary TakeoffOptions, no Revit anywhere. These tests prove the loop on
// a synthetic-but-non-trivial scene (four rooms, two 3-ft door gaps, a diagonal wall, an
// open-plan area); ProjectA_snapshot_replays_deterministically upgrades to the real captured
// project-a state automatically once a live run has produced replay_<level>.bin (run-takeoff.py —
// capture is on by default via TakeoffOptions.DumpReplaySnapshot).
public sealed class TakeoffReplayTests
{
    // 60 x 40 ft at 0.5 ft cells. Envelope ring; west block split into rooms A/B by a wall with a
    // 3-ft door gap; a full-height divider with a second 3-ft door gap onto the east open-plan
    // area; a 45-degree diagonal wall sealing a triangular room off the open plan's SE corner.
    // Every floor cell carries a 9-ft ceiling, so ceiling gates pass and door gaps are the only
    // topology question: unsealed they merge A+B+open-plan into one region.
    private static DetectSnapshot BuildSyntheticEstate()
    {
        const int W = 120, H = 80;
        const double cell = 0.5;
        int n = W * H;
        var hf = new Heightfield {
            W = W, H = H, MinX = 0, MinY = 0, CellFt = cell,
            FloorZ = new float[n], CeilZ = new float[n],
        };
        for (int i = 0; i < n; i++) { hf.FloorZ[i] = float.NaN; hf.CeilZ[i] = float.NaN; }
        for (int y = 8; y < 72; y++)
            for (int x = 8; x < 112; x++)
            { hf.FloorZ[y * W + x] = 0f; hf.CeilZ[y * W + x] = 9f; }

        var ink = new bool[n];
        void Stamp(int x0, int x1, int y0, int y1)
        {
            for (int y = y0; y < y1; y++)
                for (int x = x0; x < x1; x++)
                    ink[y * W + x] = true;
        }
        Stamp(8, 112, 8, 10); Stamp(8, 112, 70, 72);     // envelope south/north
        Stamp(8, 10, 8, 72); Stamp(110, 112, 8, 72);     // envelope west/east
        Stamp(48, 50, 8, 20); Stamp(48, 50, 26, 72);     // divider, 3-ft door gap y=[20,26)
        Stamp(8, 28, 40, 42); Stamp(34, 48, 40, 42);     // A/B wall, 3-ft door gap x=[28,34)
        for (int t = 0; t <= 30; t++) Stamp(80 + t, 82 + t, 8 + t, 10 + t); // diagonal, 2 cells thick

        return new DetectSnapshot {
            LevelName = "Synthetic Level", LevelElevation = 0,
            CaptureOptions = "synthetic", Field = hf, SeedInk = ink,
        };
    }

    private static TakeoffOptions ReplayOptions(bool sealDoorGaps) => new() {
        CellFt = 0.5, SealWallRunGaps = sealDoorGaps,
    };

    private static string TempPath(string name) =>
        Path.Combine(Path.GetTempPath(), $"pe-takeoff-replay-{Guid.NewGuid():N}-{name}");

    [Test]
    public void Tsv_round_trip_preserves_room_flags_and_residue()
    {
        var source = new TakeoffResult {
            LevelName = "Flags",
            Rooms = {
                new RoomResult {
                    Id = "R07", RawSqft = 100, PerimeterFt = 40,
                    LabelX = 5, LabelY = 5, MeanCeilingFt = 9,
                    Polygon = new() { new[] { 0d, 0d }, new[] { 10d, 0d }, new[] { 10d, 10d }, new[] { 0d, 10d } },
                    Flags = new() { "open-plan-merge", "low-evidence-boundary" },
                },
            },
            TotalSqft = 100,
            Residues = {
                new ResidueResult {
                    Id = "X01", Reason = ResidueReason.Border, RawSqft = 25,
                    LabelX = 12.5, LabelY = 2.5, MeanCeilingFt = 8,
                    Polygon = new() { new[] { 10d, 0d }, new[] { 15d, 0d }, new[] { 15d, 5d }, new[] { 10d, 5d } },
                },
            },
        };

        var loaded = RoomTakeoff.LoadResult(source.ToTsv(), source.LevelName, source.LevelElevation);

        Assert.Multiple(() => {
            Assert.That(loaded.Rooms.Single().Flags, Is.EqualTo(source.Rooms.Single().Flags));
            Assert.That(SpaceMaterializer.SpaceComments("owned", loaded.Rooms.Single()),
                Is.EqualTo("owned|R07\npe-takeoff: open-plan-merge, low-evidence-boundary"));
            Assert.That((loaded.Residues.Single().Id, loaded.Residues.Single().Reason,
                    loaded.Residues.Single().RawSqft, loaded.Residues.Single().LabelX,
                    loaded.Residues.Single().LabelY, loaded.Residues.Single().MeanCeilingFt),
                Is.EqualTo(("X01", ResidueReason.Border, 25d, 12.5d, 2.5d, 8d)));
            Assert.That(loaded.Residues.Single().Polygon, Is.EqualTo(source.Residues.Single().Polygon));
        });
    }

    [Test]
    public void Replay_is_deterministic_and_option_sensitive()
    {
        string path = TempPath("estate.bin");
        try
        {
            DetectSnapshot.Save(path, BuildSyntheticEstate());
            var snap = DetectSnapshot.Load(path);

            var sealedRun = snap.Replay(ReplayOptions(sealDoorGaps: true), _ => { });
            var openRun = snap.Replay(ReplayOptions(sealDoorGaps: false), _ => { });

            // Sealed: A, B, open-plan, diagonal triangle. Unsealed: the two door gaps merge
            // A+B+open-plan into one region; only the triangle stays separate.
            Assert.Multiple(() => {
                Assert.That(sealedRun.Rooms, Has.Count.EqualTo(4));
                Assert.That(openRun.Rooms, Has.Count.EqualTo(2));
                Assert.That(sealedRun.LevelName, Is.EqualTo("Synthetic Level"));
                Assert.That(sealedRun.Rooms.All(r => r.RawSqft >= 80), Is.True);
                Assert.That(sealedRun.Rooms.All(r => r.Polygon.Count >= 3), Is.True);
            });

            // Determinism: a second replay from a second load produces the byte-identical TSV
            // (the same payload the live lane commits to eval/rhvac/<project>/takeoff/).
            var again = DetectSnapshot.Load(path).Replay(ReplayOptions(sealDoorGaps: true), _ => { });
            string tsvA = TempPath("a.tsv"), tsvB = TempPath("b.tsv");
            try
            {
                File.WriteAllText(tsvA, sealedRun.ToTsv());
                File.WriteAllText(tsvB, again.ToTsv());
                Assert.That(File.ReadAllBytes(tsvB), Is.EqualTo(File.ReadAllBytes(tsvA)));
            }
            finally { File.Delete(tsvA); File.Delete(tsvB); }
        }
        finally { File.Delete(path); }
    }

    [Test]
    public void Snapshot_roundtrip_is_byte_identical()
    {
        string first = TempPath("first.bin"), second = TempPath("second.bin");
        try
        {
            DetectSnapshot.Save(first, BuildSyntheticEstate());
            var loaded = DetectSnapshot.Load(first);
            DetectSnapshot.Save(second, loaded);
            Assert.That(File.ReadAllBytes(second), Is.EqualTo(File.ReadAllBytes(first)));
            Assert.That(loaded.CaptureOptions, Is.EqualTo("synthetic"));
        }
        finally { File.Delete(first); File.Delete(second); }
    }

    [Test]
    public void Replay_fail_fasts_on_cell_size_mismatch()
    {
        var snap = BuildSyntheticEstate(); // 0.5 ft cells
        Assert.That(
            () => snap.Replay(new TakeoffOptions(), _ => { }), // default CellFt = 0.25
            Throws.InvalidOperationException.With.Message.Contains("CellFt"));
    }

    [Test]
    public void Level_profile_uses_evidence_not_level_name()
    {
        var flat = BuildSyntheticEstate();
        flat.LevelName = "ROOF PLAN"; // deliberately misleading: names are not policy evidence
        var flatProfile = TakeoffPolicy.InferLevelProfile(flat);

        var roof = BuildSyntheticEstate();
        roof.LevelName = "Main Level"; // deliberately misleading in the opposite direction
        for (int i = 0; i < roof.Field.CeilZ.Length; i++)
            if (!float.IsNaN(roof.Field.FloorZ[i])) roof.Field.CeilZ[i] = roof.Field.FloorZ[i];
        var roofProfile = TakeoffPolicy.InferLevelProfile(roof);
        var callerOptions = new TakeoffOptions { MinSqft = 123, BoundaryEvidenceMin = 0.77 };
        flatProfile.ApplyPolicyTo(callerOptions);

        Assert.Multiple(() => {
            Assert.That(flatProfile.CeilingCoverage, Is.EqualTo(1).Within(1e-9));
            Assert.That(flatProfile.HabitableFraction, Is.EqualTo(1).Within(1e-9));
            Assert.That(flatProfile.Options.RequireCeiling, Is.True);
            Assert.That(flatProfile.Options.SealDoorHeads, Is.True);
            Assert.That(flatProfile.Options.SealWallRunGaps, Is.True);
            Assert.That(flatProfile.NoHabitableDomain, Is.False);
            Assert.That(roofProfile.HabitableFraction, Is.Zero);
            Assert.That(roofProfile.NoHabitableDomain, Is.True);
            Assert.That(callerOptions.MinSqft, Is.EqualTo(123));
            Assert.That(callerOptions.BoundaryEvidenceMin, Is.EqualTo(0.77));
        });

        var inferredRoof = roof.ReplayInferred(_ => { });
        Assert.Multiple(() => {
            Assert.That(inferredRoof.Rooms, Is.Empty);
            Assert.That(inferredRoof.ToTsv(), Does.Contain("META\tprofile\tceilingCoverage="));
            Assert.That(inferredRoof.ToTsv(), Does.Contain("META\tflag\tlevel:Main Level:no-habitable-domain"));
            Assert.That(flat.ReplayInferred(_ => { }).ToTsv(),
                Is.EqualTo(flat.ReplayInferred(_ => { }).ToTsv()),
                "inferred provenance and replay output must stay deterministic");
        });
    }

    [Test]
    public void Level_profile_derives_attic_double_height_and_seed_policy()
    {
        var attic = BuildSyntheticEstate();
        for (int i = 0; i < attic.Field.CeilZ.Length; i++)
            if (!float.IsNaN(attic.Field.CeilZ[i])) attic.Field.CeilZ[i] = 7 + 2 * (i % 2);
        var rawAtticCeiling = (float[])attic.Field.CeilZ.Clone();
        var atticProfile = TakeoffPolicy.InferLevelProfile(attic);
        attic.ReplayInferred(_ => { });

        var doubleHeight = BuildSyntheticEstate();
        for (int i = 0; i < doubleHeight.Field.CeilZ.Length; i++)
            if (!float.IsNaN(doubleHeight.Field.CeilZ[i]) && i % doubleHeight.Field.W > 60)
                doubleHeight.Field.CeilZ[i] = 20;
        var doubleProfile = TakeoffPolicy.InferLevelProfile(doubleHeight);

        var stepped = BuildSyntheticEstate();
        for (int i = 0; i < stepped.SeedInk.Length; i++)
            if (stepped.SeedInk[i] && !float.IsNaN(stepped.Field.CeilZ[i])) stepped.Field.CeilZ[i] = 12;
        var hybridProfile = TakeoffPolicy.InferLevelProfile(stepped);
        stepped.LevelElevation = -1;
        for (int i = 0; i < stepped.Field.FloorZ.Length; i++)
        {
            if (!float.IsNaN(stepped.Field.FloorZ[i])) stepped.Field.FloorZ[i]--;
            if (!float.IsNaN(stepped.Field.CeilZ[i])) stepped.Field.CeilZ[i]--;
        }
        var basementProfile = TakeoffPolicy.InferLevelProfile(stepped);

        Assert.Multiple(() => {
            Assert.That(atticProfile.SlopedCeilingFraction, Is.GreaterThanOrEqualTo(0.9));
            Assert.That(atticProfile.Options.MinHeadroomFt, Is.EqualTo(3.5));
            Assert.That(atticProfile.Options.CeilingCloseFt, Is.EqualTo(3));
            Assert.That(atticProfile.Options.SealWallRunGaps, Is.False);
            Assert.That(attic.Field.CeilZ, Is.EqualTo(rawAtticCeiling),
                "profile-specific closing must not change replay evidence");
            Assert.That(doubleProfile.DoubleHeightFraction, Is.GreaterThan(0.4));
            Assert.That(doubleProfile.Options.StoryCapFt, Is.EqualTo(20));
            Assert.That(hybridProfile.Options.SeedSource, Is.EqualTo(TakeoffSeedSource.Hybrid));
            Assert.That(basementProfile.Options.SeedSource, Is.EqualTo(TakeoffSeedSource.RegionCores));
        });
    }

    // ---- partition formulation semantics (phase 2, eval/rhvac/PHASE2-PARTITION.md) ----

    private static TakeoffOptions PartitionOptions() => new() { CellFt = 0.5, SealWallRunGaps = true };

    [Test]
    public void Partition_assigns_every_domain_cell_with_no_slivers_or_overlaps()
    {
        var snap = BuildSyntheticEstate();
        var run = snap.Replay(PartitionOptions(), _ => { });

        // The estate's domain is the full floored rectangle x[8,112) y[8,72) = 52ft x 32ft,
        // wall/ink cells included (floor + 9-ft ceiling everywhere). Assignment totality + no
        // overlap means the emitted room areas sum EXACTLY to the domain area — no holes by
        // construction, wall thickness split between neighbors, nothing double-claimed.
        const double domainSqft = 52 * 32;
        Assert.Multiple(() => {
            Assert.That(run.Rooms.Sum(r => r.RawSqft), Is.EqualTo(domainSqft).Within(1e-6));
            Assert.That(run.Rooms, Has.Count.EqualTo(4)); // A, B, open-plan, diagonal triangle
            Assert.That(run.Rooms.All(r => r.RawSqft >= new TakeoffOptions().MinSqft), Is.True,
                "sliver dissolution must leave no under-min-area rooms");
        });

        // RawSqft above remains the exact partition conservation truth. Regularized geometry may
        // drift only by its explicit per-room allowance; rooms beyond it revert to raw polygons.
        double Shoe(List<double[]> p)
        {
            double s = 0;
            for (int i = 0; i < p.Count; i++)
            { var a = p[i]; var b = p[(i + 1) % p.Count]; s += a[0] * b[1] - b[0] * a[1]; }
            return Math.Abs(s / 2);
        }
        Assert.That(run.Rooms, Has.All.Matches<RoomResult>(room =>
            Math.Abs(Shoe(room.Polygon) - room.Holes.Sum(Shoe) - room.RawSqft)
            <= Math.Max(0.5, new TakeoffOptions().RegularizeAreaTolerancePct / 100 * room.RawSqft) + 1e-6));
    }

    [Test]
    public void Partition_replay_is_deterministic()
    {
        string path = TempPath("estate-part.bin");
        try
        {
            DetectSnapshot.Save(path, BuildSyntheticEstate());
            var first = DetectSnapshot.Load(path).ReplayInferred(_ => { });
            var second = DetectSnapshot.Load(path).ReplayInferred(_ => { });
            Assert.That(second.ToTsv(), Is.EqualTo(first.ToTsv()));
        }
        finally { File.Delete(path); }
    }

    // Open-plan scene: one long 6-ft-tall space whose midpoint has only half-foot wall stubs —
    // enough to break the seed plateau's 3-ft clearance (hybrid splits there), while the shared
    // boundary stays ~83% unbacked by evidence, so the merge criterion re-merges the halves and
    // FLAGS the merge; the flag must ride the TSV as a backward-compatible 3-column META line.
    [Test]
    public void Partition_flags_open_plan_merges()
    {
        const int W = 120, H = 28;
        const double cell = 0.5;
        int n = W * H;
        var hf = new Heightfield {
            W = W, H = H, MinX = 0, MinY = 0, CellFt = cell,
            FloorZ = new float[n], CeilZ = new float[n],
        };
        for (int i = 0; i < n; i++) { hf.FloorZ[i] = float.NaN; hf.CeilZ[i] = float.NaN; }
        for (int y = 6; y < 22; y++)
            for (int x = 8; x < 112; x++)
            { hf.FloorZ[y * W + x] = 0f; hf.CeilZ[y * W + x] = 9f; }
        var ink = new bool[n];
        void Stamp(int x0, int x1, int y0, int y1)
        {
            for (int y = y0; y < y1; y++)
                for (int x = x0; x < x1; x++) ink[y * W + x] = true;
        }
        Stamp(8, 112, 6, 8); Stamp(8, 112, 20, 22);   // long north/south walls
        Stamp(8, 10, 6, 22); Stamp(110, 112, 6, 22);  // end walls
        Stamp(59, 61, 8, 9); Stamp(59, 61, 19, 20);   // half-foot stubs at the midpoint

        var snap = new DetectSnapshot {
            LevelName = "Open Plan", LevelElevation = 0, CaptureOptions = "synthetic",
            Field = hf, SeedInk = ink,
        };
        // The watershed boundary hugs the stub pinch, so its evidence backing sits just above the
        // default merge bar (it draws the low-evidence flag there). Semantics under test are
        // parametric: below MinBoundarySupport the halves are ONE open-plan space, flagged.
        var opt = PartitionOptions();
        opt.SeedSource = TakeoffSeedSource.Hybrid;
        var split = snap.Replay(opt, _ => { });
        Assert.Multiple(() => {
            Assert.That(split.Rooms, Has.Count.EqualTo(2), "the pinch must split the hybrid seeds");
            Assert.That(split.Rooms.SelectMany(r => r.Flags), Does.Contain("low-evidence-boundary"));
        });

        opt.MinBoundarySupport = 0.75; // stricter wall-backing demand -> this boundary is open-plan
        var strict = snap.Replay(opt, _ => { });
        Assert.Multiple(() => {
            Assert.That(strict.Rooms, Has.Count.EqualTo(1), "unbacked split must merge back");
            Assert.That(strict.Rooms[0].Flags, Does.Contain("open-plan-merge"));
            Assert.That(strict.ToTsv(), Does.Contain($"META\tflag\t{strict.Rooms[0].Id}:"));
        });
    }

    [Test]
    public void Partition_flags_suspect_regions_without_changing_geometry()
    {
        const int W = 100, H = 60;
        const double cell = 0.5;
        int n = W * H;
        var hf = new Heightfield {
            W = W, H = H, MinX = 0, MinY = 0, CellFt = cell,
            FloorZ = Enumerable.Repeat(float.NaN, n).ToArray(),
            CeilZ = Enumerable.Repeat(float.NaN, n).ToArray(),
        };
        void Floor(int x0, int x1, int y0, int y1)
        {
            for (int y = y0; y < y1; y++)
                for (int x = x0; x < x1; x++)
                { hf.FloorZ[y * W + x] = 0; hf.CeilZ[y * W + x] = 9; }
        }
        Floor(8, 28, 8, 28);       // ordinary 10 x 10 ft room
        Floor(40, 43, 8, 48);      // 1.5 x 20 ft ribbon
        Floor(40, 48, 40, 48);     // one 4 x 4 ft bulge lets it survive max-width dissolution
        for (int i = 0; i < n; i++)
            if (!float.IsNaN(hf.CeilZ[i])) hf.CeilZ[i] = i % 2 == 0 ? 8 : 10;
        var snap = new DetectSnapshot {
            LevelName = "Suspect", LevelElevation = 0, CaptureOptions = "synthetic",
            Field = hf, SeedInk = new bool[n],
        };
        var opt = new TakeoffOptions {
            CellFt = cell, MinSqft = 20, MinFeatureWidthFt = 2.5,
            MinRegionCompactness = 0.25,
        };

        var result = snap.Replay(opt, _ => { });

        Assert.Multiple(() => {
            Assert.That(result.Rooms, Has.Count.EqualTo(2));
            Assert.That(result.TotalSqft, Is.EqualTo(140).Within(0.01));
            Assert.That(result.Rooms.Single(r => r.RawSqft < 50).Flags,
                Does.Contain("suspect:compactness").And.Contain("suspect:narrow")
                    .And.Contain("suspect:ceiling-variance"));
            Assert.That(result.Rooms.Single(r => r.RawSqft >= 50).Flags,
                Is.Empty);
        });
        opt.MinRegionCompactness = double.NaN;
        Assert.Throws<ArgumentOutOfRangeException>(() => snap.Replay(opt, _ => { }));
        opt.MinRegionCompactness = 0;
        opt.MinSuspectCeilingStdDevFt = double.NaN;
        Assert.Throws<ArgumentOutOfRangeException>(() => snap.Replay(opt, _ => { }));
        opt.MinSuspectCeilingStdDevFt = 0.5;
        opt.SuspectMaxSqft = -1;
        Assert.Throws<ArgumentOutOfRangeException>(() => snap.Replay(opt, _ => { }));
    }

    // ---- detector-side shared-boundary regularization ----

    [Test]
    public void Regularizer_preserves_every_raw_room_on_fallback()
    {
        var rooms = DiagonalSeamRooms();
        var before = rooms.ToDictionary(
            room => room.Id,
            room => room.Polygon.SelectMany(point => point).ToArray(),
            StringComparer.Ordinal);

        SpaceBoundaryNetwork.Regularize(rooms, 1, 1, 3, (_, _) => true);

        Assert.Multiple(() => {
            Assert.That(rooms.Select(room => room.Id), Is.EquivalentTo(before.Keys));
            Assert.That(rooms, Has.All.Matches<RoomResult>(room =>
                room.Polygon.Count >= 3
                && room.Polygon.SelectMany(point => point).SequenceEqual(before[room.Id])));
        });
    }

    [Test]
    public void Regularizer_flags_unregularized_rooms()
    {
        var rooms = DiagonalSeamRooms();

        SpaceBoundaryNetwork.Regularize(rooms, 1, 1, 3, (_, _) => true);

        Assert.That(rooms, Has.All.Matches<RoomResult>(room => room.Flags.Contains("unregularized")));
    }

    [Test]
    public void Regularizer_area_guard_reverts_to_raw_polygon()
    {
        var room = Room("A", [new[] { 0d, 0 }, new[] { 10d, 0 }, new[] { 10d, 10 }, new[] { 0d, 10 }]);
        room.RawSqft = 80;
        var raw = room.Polygon.Select(point => point.ToArray()).ToList();

        SpaceBoundaryNetwork.Regularize([room], 1, 1, 3, (_, _) => false);

        Assert.Multiple(() => {
            Assert.That(room.Polygon.SelectMany(point => point), Is.EqualTo(raw.SelectMany(point => point)));
            Assert.That(room.RawSqft, Is.EqualTo(80));
            Assert.That(room.Flags, Does.Contain("unregularized"));
        });
    }

    [Test]
    public void Regularizer_area_tolerance_knob_distinguishes_one_from_three_percent()
    {
        RoomResult Candidate() => new() {
            Id = "A", RawSqft = 98, LabelX = 5, LabelY = 5,
            Polygon = [new[] { 0d, 0 }, new[] { 10d, 0 }, new[] { 10d, 10 }, new[] { 0d, 10 }],
        };
        var strict = Candidate();
        var standard = Candidate();

        SpaceBoundaryNetwork.Regularize([strict], 1, 1, 1, (_, _) => false);
        SpaceBoundaryNetwork.Regularize(
            [standard], 1, 1, new TakeoffOptions().RegularizeAreaTolerancePct, (_, _) => false);

        Assert.Multiple(() => {
            Assert.That(strict.RawSqft, Is.EqualTo(98));
            Assert.That(strict.Flags, Does.Contain("unregularized"));
            Assert.That(standard.RawSqft, Is.EqualTo(98), "cell-count area remains the conservation truth");
            Assert.That(standard.Flags, Does.Not.Contain("unregularized"));
        });
    }

    [Test]
    public void Regularizer_preserves_short_closed_holes_without_failing_the_room()
    {
        var room = Room("A", [new[] { 0d, 0 }, new[] { 10d, 0 }, new[] { 10d, 10 }, new[] { 0d, 10 }]);
        room.Holes = [[new[] { 4d, 4 }, new[] { 4d, 5 }, new[] { 5d, 5 }, new[] { 5d, 4 }]];
        room.RawSqft = 99;

        SpaceBoundaryNetwork.Regularize([room], 1, 1, 3, (_, _) => false);

        Assert.Multiple(() => {
            Assert.That(room.Flags, Does.Not.Contain("unregularized"));
            Assert.That(room.Holes, Has.Count.EqualTo(1));
            Assert.That(room.RawSqft, Is.EqualTo(99));
        });
    }

    [Test]
    public void Regularizer_flags_ruled_seams_without_ink_support()
    {
        var rooms = DiagonalSeamRooms();

        SpaceBoundaryNetwork.Regularize(rooms, 1, 1, 3, (_, _) => false);

        Assert.That(rooms.SelectMany(room => room.Flags), Does.Contain("ruled-seam"));
    }

    private static RoomResult[] DiagonalSeamRooms()
    {
        var seam = new List<double[]>();
        for (int i = 0; i < 8; i++)
        {
            seam.Add(new[] { 50d + i, 0d + i });
            seam.Add(new[] { 50d + i, 1d + i });
        }
        seam.Add(new[] { 58d, 8d });
        var a = new List<double[]> { new[] { 0d, 0 }, new[] { 50d, 0 } };
        a.AddRange(seam.Skip(1));
        a.AddRange([new[] { 58d, 60 }, new[] { 0d, 60 }]);
        var b = new List<double[]> {
            new[] { 50d, 0 }, new[] { 100d, 0 }, new[] { 100d, 60 },
            new[] { 58d, 60 }, new[] { 58d, 8 },
        };
        b.AddRange(seam.Skip(1).Reverse().Skip(1));
        return [Room("A", a), Room("B", b)];
    }

    private static RoomResult Room(string id, List<double[]> polygon) => new() {
        Id = id,
        RawSqft = Math.Abs(polygon.Select((point, index) => {
            var next = polygon[(index + 1) % polygon.Count];
            return point[0] * next[1] - next[0] * point[1];
        }).Sum() / 2),
        LabelX = polygon.Average(point => point[0]),
        LabelY = polygon.Average(point => point[1]),
        Polygon = polygon,
    };

    [Test]
    public void ProjectA_snapshot_replays_deterministically()
    {
        // Real-data replay: activates once any live Detect run has captured a snapshot.
        var candidates = new[] {
                Environment.ExpandEnvironmentVariables(@"%USERPROFILE%\OneDrive\Documents\Pe.Tools\takeoff"),
                Environment.ExpandEnvironmentVariables(@"%USERPROFILE%\Documents\Pe.Tools\takeoff"),
            }
            .Where(Directory.Exists)
            .SelectMany(dir => Directory.GetFiles(dir, "replay_*.bin"))
            .OrderBy(f => f, StringComparer.Ordinal)
            .ToList();
        if (candidates.Count == 0)
            Assert.Ignore("no live capture yet — the next eval/rhvac/run-takeoff.py run writes replay_<level>.bin automatically");

        var snap = DetectSnapshot.Load(candidates[0]);
        var opt = new TakeoffOptions { CellFt = snap.Field.CellFt };
        var first = snap.Replay(opt, _ => { });
        var second = DetectSnapshot.Load(candidates[0]).Replay(opt, _ => { });
        Assert.Multiple(() => {
            Assert.That(first.Rooms, Is.Not.Empty);
            Assert.That(second.ToTsv(), Is.EqualTo(first.ToTsv()));
        });
    }
}
