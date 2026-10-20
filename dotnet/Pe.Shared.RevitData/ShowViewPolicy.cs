namespace Pe.Shared.RevitData;

/// <summary>What a view can show: a model view holds model elements; anything else (sheet, schedule, legend, drafting) does not.</summary>
public enum ShowViewRole { Plan, Section, ThreeD, NonModel }

/// <summary>One view as the chooser sees it. <paramref name="OnElementLevel" /> is true for a plan generated on a level the elements sit on.</summary>
public sealed record ShowViewInfo(long Id, string Name, ShowViewRole Role, bool IsActive, bool OnElementLevel);

/// <summary>
///     Which views to try, in order, when the person asked to be shown elements. The caller tests each with the
///     real "does this view display them" check and takes the first that passes, so the order is the policy:
///     the active model view, then the default <c>{3D}</c>, other 3D views by name, then plans on the elements' levels.
/// </summary>
public static class ShowViewPolicy {
    public const string DefaultThreeDName = "{3D}";
    public const int MaxCandidates = 8;

    public static IReadOnlyList<ShowViewInfo> Order(IEnumerable<ShowViewInfo> views) {
        var all = views.Where(view => view.Role != ShowViewRole.NonModel).ToList();
        var active = all.Where(view => view.IsActive);
        var threeD = all
            .Where(view => view is { Role: ShowViewRole.ThreeD, IsActive: false })
            .OrderBy(view => view.Name == DefaultThreeDName ? 0 : 1)
            .ThenBy(view => view.Name, StringComparer.OrdinalIgnoreCase);
        var plans = all
            .Where(view => view is { Role: ShowViewRole.Plan, IsActive: false, OnElementLevel: true })
            .OrderBy(view => view.Name, StringComparer.OrdinalIgnoreCase);
        return active.Concat(threeD).Concat(plans).Take(MaxCandidates).ToList();
    }
}
