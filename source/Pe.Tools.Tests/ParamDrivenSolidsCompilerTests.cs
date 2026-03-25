using Pe.FamilyFoundry;
using Pe.FamilyFoundry.Resolution;
using Pe.FamilyFoundry.Snapshots;

namespace Pe.Tools.Tests;

public sealed class ParamDrivenSolidsCompilerTests : RevitTestBase {
    [Test]
    public async Task Compile_rectangle_generates_internal_ref_planes_and_extrusion() {
        var settings = new ParamDrivenSolidsSettings {
            Rectangles = [
                new ParamDrivenRectangleSpec {
                    Name = "MagicBox",
                    Sketch = new SketchTargetSpec { Plane = "Ref. Level" },
                    Width = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Mirror,
                        Parameter = "Width",
                        CenterAnchor = "Center (Front/Back)",
                        PlaneNameBase = "width",
                        Strength = RpStrength.StrongRef
                    },
                    Length = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Mirror,
                        Parameter = "Length",
                        CenterAnchor = "Center (Left/Right)",
                        PlaneNameBase = "length",
                        Strength = RpStrength.StrongRef
                    },
                    Height = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Offset,
                        Parameter = "Height",
                        Anchor = "Reference Plane",
                        Direction = OffsetDirection.Positive,
                        PlaneNameBase = "top",
                        Strength = RpStrength.StrongRef
                    }
                }
            ]
        };

        var result = ParamDrivenSolidsCompiler.Compile(settings);

        await Assert.That(result.CanExecute).IsTrue();
        await Assert.That(result.RefPlanesAndDims.MirrorSpecs.Count).IsEqualTo(2);
        await Assert.That(result.RefPlanesAndDims.OffsetSpecs.Count).IsEqualTo(1);
        await Assert.That(result.InternalExtrusions.Rectangles.Count).IsEqualTo(1);
        await Assert.That(result.InternalExtrusions.Rectangles[0].PairAPlane1).IsEqualTo("width (Back)");
        await Assert.That(result.InternalExtrusions.Rectangles[0].PairBPlane2).IsEqualTo("length (Right)");
        await Assert.That(result.InternalExtrusions.Rectangles[0].HeightPlaneTop).IsEqualTo("top");
    }

    [Test]
    public async Task Compile_blocks_ambiguous_inference() {
        var settings = new ParamDrivenSolidsSettings {
            Rectangles = [
                new ParamDrivenRectangleSpec {
                    Name = "BadBox",
                    Sketch = new SketchTargetSpec { Plane = "Ref. Level" },
                    Width = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Mirror,
                        Parameter = "Width",
                        CenterAnchor = "Center (Front/Back)",
                        Inference = new InferenceInfo {
                            Status = InferenceStatus.Ambiguous,
                            Warnings = ["Needs manual review."]
                        }
                    },
                    Length = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Mirror,
                        Parameter = "Length",
                        CenterAnchor = "Center (Left/Right)"
                    },
                    Height = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Offset,
                        Parameter = "Height",
                        Anchor = "Reference Plane"
                    }
                }
            ]
        };

        var result = ParamDrivenSolidsCompiler.Compile(settings);

        await Assert.That(result.CanExecute).IsFalse();
        await Assert.That(result.Diagnostics.Any(diagnostic =>
            diagnostic.Severity == ParamDrivenDiagnosticSeverity.Error &&
            diagnostic.Message.Contains("Ambiguous", StringComparison.OrdinalIgnoreCase))).IsTrue();
    }

    [Test]
    public async Task Compile_dedupes_exact_shared_constraints() {
        var sharedWidth = new AxisConstraintSpec {
            Mode = AxisConstraintMode.Mirror,
            Parameter = "Width",
            CenterAnchor = "Center (Front/Back)",
            PlaneNameBase = "width",
            Strength = RpStrength.StrongRef
        };
        var sharedLength = new AxisConstraintSpec {
            Mode = AxisConstraintMode.Mirror,
            Parameter = "Length",
            CenterAnchor = "Center (Left/Right)",
            PlaneNameBase = "length",
            Strength = RpStrength.StrongRef
        };

        var settings = new ParamDrivenSolidsSettings {
            Rectangles = [
                new ParamDrivenRectangleSpec {
                    Name = "Lower",
                    Sketch = new SketchTargetSpec { Plane = "Ref. Level" },
                    Width = sharedWidth,
                    Length = sharedLength,
                    Height = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Offset,
                        Parameter = "LowerHeight",
                        Anchor = "Reference Plane",
                        Direction = OffsetDirection.Positive,
                        PlaneNameBase = "lower top"
                    }
                },
                new ParamDrivenRectangleSpec {
                    Name = "Upper",
                    Sketch = new SketchTargetSpec { Plane = "Lower.Height.Top" },
                    Width = sharedWidth,
                    Length = sharedLength,
                    Height = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Offset,
                        Parameter = "UpperHeight",
                        Anchor = "Lower.Height.Top",
                        Direction = OffsetDirection.Positive,
                        PlaneNameBase = "upper top"
                    }
                }
            ]
        };

        var result = ParamDrivenSolidsCompiler.Compile(settings);

        await Assert.That(result.CanExecute).IsTrue();
        await Assert.That(result.RefPlanesAndDims.MirrorSpecs.Count).IsEqualTo(2);
        await Assert.That(result.InternalExtrusions.Rectangles.Count).IsEqualTo(2);
    }
}
