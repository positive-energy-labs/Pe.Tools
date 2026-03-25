using Pe.FamilyFoundry;
using Pe.FamilyFoundry.Resolution;
using Pe.FamilyFoundry.Snapshots;

namespace Pe.Tools.RevitTest.Tests;

[TestFixture]
public sealed class ParamDrivenSolidsCompilerTests {
    [Test]
    public void Compile_rectangle_generates_internal_ref_planes_and_extrusion() {
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

        Assert.That(result.CanExecute, Is.True);
        Assert.That(result.RefPlanesAndDims.MirrorSpecs, Has.Count.EqualTo(2));
        Assert.That(result.RefPlanesAndDims.OffsetSpecs, Has.Count.EqualTo(1));
        Assert.That(result.InternalExtrusions.Rectangles, Has.Count.EqualTo(1));
        Assert.That(result.InternalExtrusions.Rectangles[0].PairAPlane1, Is.EqualTo("width (Back)"));
        Assert.That(result.InternalExtrusions.Rectangles[0].PairBPlane2, Is.EqualTo("length (Right)"));
        Assert.That(result.InternalExtrusions.Rectangles[0].HeightPlaneTop, Is.EqualTo("top"));
    }

    [Test]
    public void Compile_blocks_ambiguous_inference() {
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

        Assert.That(result.CanExecute, Is.False);
        Assert.That(result.Diagnostics.Any(diagnostic =>
            diagnostic.Severity == ParamDrivenDiagnosticSeverity.Error &&
            diagnostic.Message.Contains("Ambiguous", StringComparison.OrdinalIgnoreCase)), Is.True);
    }

    [Test]
    public void Compile_dedupes_exact_shared_constraints() {
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

        Assert.That(result.CanExecute, Is.True);
        Assert.That(result.RefPlanesAndDims.MirrorSpecs, Has.Count.EqualTo(2));
        Assert.That(result.InternalExtrusions.Rectangles, Has.Count.EqualTo(2));
    }

    [Test]
    public void Compile_cylinder_can_target_rectangle_top_plane_alias() {
        var settings = new ParamDrivenSolidsSettings {
            Rectangles = [
                new ParamDrivenRectangleSpec {
                    Name = "Box",
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
                        Parameter = "BoxHeight",
                        Anchor = "Reference Plane",
                        Direction = OffsetDirection.Positive,
                        PlaneNameBase = "box top",
                        Strength = RpStrength.StrongRef
                    }
                }
            ],
            Cylinders = [
                new ParamDrivenCylinderSpec {
                    Name = "TopCylinder",
                    Sketch = new SketchTargetSpec { Plane = "Box.Height.Top" },
                    CenterLeftRightAnchor = "Center (Left/Right)",
                    CenterFrontBackAnchor = "Center (Front/Back)",
                    Diameter = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Mirror,
                        Parameter = "Diameter",
                        PlaneNameBase = "diameter",
                        Strength = RpStrength.StrongRef
                    },
                    Height = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Offset,
                        Parameter = "CylinderHeight",
                        Anchor = "Box.Height.Top",
                        Direction = OffsetDirection.Positive,
                        PlaneNameBase = "cylinder top",
                        Strength = RpStrength.StrongRef
                    }
                }
            ]
        };

        var result = ParamDrivenSolidsCompiler.Compile(settings);

        Assert.That(result.CanExecute, Is.True);
        Assert.That(result.InternalExtrusions.Circles, Has.Count.EqualTo(1));
        Assert.That(result.InternalExtrusions.Circles[0].SketchPlaneName, Is.EqualTo("box top"));
        Assert.That(result.InternalExtrusions.Circles[0].HeightPlaneBottom, Is.EqualTo("box top"));
        Assert.That(result.InternalExtrusions.Circles[0].HeightPlaneTop, Is.EqualTo("cylinder top"));
    }

    [Test]
    public void Compile_blocks_ambiguous_cylinder_inference() {
        var settings = new ParamDrivenSolidsSettings {
            Cylinders = [
                new ParamDrivenCylinderSpec {
                    Name = "BadCylinder",
                    Sketch = new SketchTargetSpec { Plane = "Ref. Level" },
                    CenterLeftRightAnchor = "Center (Left/Right)",
                    CenterFrontBackAnchor = "Center (Front/Back)",
                    Diameter = new AxisConstraintSpec {
                        Mode = AxisConstraintMode.Mirror,
                        Parameter = "Diameter",
                        Inference = new InferenceInfo {
                            Status = InferenceStatus.Ambiguous,
                            Warnings = ["Diameter semantics are ambiguous."]
                        }
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

        Assert.That(result.CanExecute, Is.False);
        Assert.That(result.Diagnostics.Any(diagnostic =>
            diagnostic.Severity == ParamDrivenDiagnosticSeverity.Error &&
            diagnostic.Message.Contains("Ambiguous", StringComparison.OrdinalIgnoreCase)), Is.True);
    }
}
