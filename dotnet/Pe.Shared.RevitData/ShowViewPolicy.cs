namespace Pe.Shared.RevitData;

/// <summary>What a view can show: a model view holds model elements; anything else (sheet, schedule, legend, drafting) does not.</summary>
public enum ShowViewRole { Plan, Section, ThreeD, NonModel }

/// <summary>One view as the chooser sees it. <paramref name="OnElementLevel" /> is true for a plan generated on a level the elements sit on.</summary>
public sealed record ShowViewInfo(long Id, string Name, ShowViewRole Role, bool IsActive, bool OnElementLevel,
    ShowViewDiscipline Discipline = ShowViewDiscipline.Other);

/// <summary>The view's discipline as far as the chooser cares: mechanical-flavoured, or other.</summary>
public enum ShowViewDiscipline { Other, Mechanical, Coordination, Plumbing, Electrical }

/// <summary>
///     Which views to try, in order, when the person asked to be shown elements. The caller tests each with the
///     real "does this view display them" check and takes the first that passes, so the order is the policy:
///     the active model view, then the default <c>{3D}</c>, mechanical-flavoured 3D views ahead of plumbing/electrical/riser/copy ones, then plans on the elements' levels.
/// </summary>
public static class ShowViewPolicy {
    public const string DefaultThreeDName = "{3D}";
    public const int MaxCandidates = 8;

    private static readonly string[] MechanicalWords = ["mech", "hvac", "duct", "M-"];
    private static readonly string[] OtherTradeWords = ["plumb", "dwv", "drain", "waste", "elec", "riser", "copy"];

    /// <summary>The default {3D} (or "{3D - user}") first, then mechanical-flavoured, then neutral, then other trades' views.</summary>
    public static bool IsDefaultThreeD(string name) =>
        name == DefaultThreeDName || (name.StartsWith("{3D - ", StringComparison.Ordinal) && name.EndsWith("}", StringComparison.Ordinal));

    private static int ThreeDRank(ShowViewInfo view) {
        if (IsDefaultThreeD(view.Name)) return 0;
        var mechanical = view.Discipline is ShowViewDiscipline.Mechanical or ShowViewDiscipline.Coordination
            || MechanicalWords.Any(w => view.Name.IndexOf(w, w == "M-" ? StringComparison.Ordinal : StringComparison.OrdinalIgnoreCase) >= 0);
        var otherTrade = view.Discipline is ShowViewDiscipline.Plumbing or ShowViewDiscipline.Electrical
            || OtherTradeWords.Any(w => view.Name.IndexOf(w, StringComparison.OrdinalIgnoreCase) >= 0);
        return mechanical && !otherTrade ? 1 : mechanical ? 2 : otherTrade ? 4 : 3;
    }

    public static IReadOnlyList<ShowViewInfo> Order(IEnumerable<ShowViewInfo> views) {
        var all = views.Where(view => view.Role != ShowViewRole.NonModel).ToList();
        var active = all.Where(view => view.IsActive);
        var threeD = all
            .Where(view => view is { Role: ShowViewRole.ThreeD, IsActive: false })
            .OrderBy(ThreeDRank)
            .ThenBy(view => view.Name, StringComparer.OrdinalIgnoreCase);
        var plans = all
            .Where(view => view is { Role: ShowViewRole.Plan, IsActive: false, OnElementLevel: true })
            .OrderBy(view => view.Name, StringComparer.OrdinalIgnoreCase);
        return active.Concat(threeD).Concat(plans).Take(MaxCandidates).ToList();
    }
}
