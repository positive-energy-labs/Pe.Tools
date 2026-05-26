using Pe.Revit.DocumentData.Schedules.Authored;
using Pe.Shared.RevitData.Schedules;

namespace Pe.Revit.Tests;

[TestFixture]
public class ScheduleProfileSotTests {
    [Test]
    public void Sparse_schedule_profile_normalizes_collections_without_adding_title_style() {
        var profile = new ScheduleProfile(
            "Grilles, Registers, and Diffusers Schedule",
            "Air Terminals"
        );

        var normalized = ScheduleProfileDefaults.Normalize(profile);

        Assert.Multiple(() => {
            Assert.That(normalized.Fields, Is.Not.Null);
            Assert.That(normalized.Fields, Is.Empty);
            Assert.That(normalized.SortGroup, Is.Not.Null);
            Assert.That(normalized.SortGroup, Is.Empty);
            Assert.That(normalized.Filters, Is.Not.Null);
            Assert.That(normalized.Filters, Is.Empty);
            Assert.That(normalized.TitleStyle, Is.Null);
            Assert.That(normalized.ColumnHeaderVerticalAlignment, Is.EqualTo(ScheduleColumnHeaderVerticalAlignment.Bottom));
            Assert.That(normalized.IsItemized, Is.True);
            Assert.That(normalized.FilterBySheet, Is.False);
        });
    }

    [Test]
    public void Combined_parameter_spec_allows_only_parameter_name_for_sparse_authoring() {
        var spec = new CombinedParameterSpec("PE_M_Grd_OpenLength");

        Assert.Multiple(() => {
            Assert.That(spec.ParameterName, Is.EqualTo("PE_M_Grd_OpenLength"));
            Assert.That(spec.Prefix, Is.Null);
            Assert.That(spec.Suffix, Is.Null);
            Assert.That(spec.Separator, Is.Null);
        });
    }

    [Test]
    public void Shared_closed_enums_map_to_revit_enums() {
        Assert.Multiple(() => {
            Assert.That(
                ScheduleAuthoredFieldDisplayType.MinMax.ToRevit(),
                Is.EqualTo(ScheduleFieldDisplayType.MinMax));
            Assert.That(
                ScheduleFieldHorizontalAlignment.Right.ToRevit(),
                Is.EqualTo(ScheduleHorizontalAlignment.Right));
            Assert.That(
                ScheduleAuthoredSortOrder.Descending.ToRevit(),
                Is.EqualTo(ScheduleSortOrder.Descending));
            Assert.That(
                ScheduleColumnHeaderVerticalAlignment.Top.ToRevit(),
                Is.EqualTo(VerticalAlignmentStyle.Top));
            Assert.That(
                ScheduleAuthoredFilterType.HasNoValue.ToRevit(),
                Is.EqualTo(ScheduleFilterType.HasNoValue));
        });
    }
}
