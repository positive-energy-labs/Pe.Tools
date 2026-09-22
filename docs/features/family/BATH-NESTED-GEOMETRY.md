# Bath nested geometry repair

Base: `673193496f82535e8776e1f81f5a7ff1865e549d`

Wave 17 produced two independent failures in the authored roundtrip:

- `c-bath-shower`: `PlaceNested` created all three `puck` instances through the level-based overload before aligning their named reference surfaces to X/Y host planes. The native API rejected every alignment as geometrically non-aligned.
- `d-bath-shower-refline`: placement reached `SetVisibility`, but its fresh `FamilyModelCapturer` could not reconstruct `stub|default|line:line-2.end`; the visibility association therefore failed before the first build could commit.

The repair stays at placement ownership. Work-plane-based symbols now use the reference/origin/reference-direction overload even when the authored host is a Level, preserving the symbol''s work-plane frame for named-reference alignment. A newly placed nested instance now receives its authored visibility association alongside its other parameter associations. The lowering DAG no longer asks `SetVisibility` to recapture a newly added/recreated nested instance. Forms and details retain their existing visibility path.

No capture code changed; b-grd array/capture ownership remains untouched. No metadata or inferred coincident planes were added.

`Bath_nested_instances_follow_authored_host_geometry` independently checks the authored consequences: three puck locations on the left/right/drain planes with X-oriented hand axes, two stubs at the two reference-line endpoints, and exactly one hot-stub visibility association.

Validation: `dotnet build dotnet/Pe.Revit.Tests/Pe.Revit.Tests.csproj -c Debug.R25.Tests --no-restore` completed with 0 errors and 20 warnings after restore. No Revit test was run. Native confirmation is still required because the local compile cannot prove Revit accepts a Level reference for the work-plane overload or that its resulting named references align.
