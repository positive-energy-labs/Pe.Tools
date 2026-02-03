using System.ComponentModel;
using System.Runtime.CompilerServices;

namespace Pe.App.Commands.Palette.FamilyPalette;

/// <summary>
///     View model for Family Instances tab filtering options.
///     Exposes properties for toggling annotation symbols, active view filtering, and category filtering.
/// </summary>
public class FamilyInstancesOptions : INotifyPropertyChanged {
    private bool _filterByActiveView;
    private string? _selectedCategory;
    private bool _showAnnotationSymbols;

    public FamilyInstancesOptions() {
        this.ShowAnnotationSymbols = false;
        this.FilterByActiveView = false;
        this.SelectedCategory = null;
    }

    /// <summary>
    ///     When false (default), annotation symbols are excluded from the Family Instances list.
    ///     When true, annotation symbols are included.
    /// </summary>
    public bool ShowAnnotationSymbols {
        get => this._showAnnotationSymbols;
        set {
            if (this._showAnnotationSymbols == value) return;
            this._showAnnotationSymbols = value;
            this.OnPropertyChanged();
        }
    }

    /// <summary>
    ///     When false (default), all instances in the document are shown.
    ///     When true, only instances visible in the active view are shown.
    /// </summary>
    public bool FilterByActiveView {
        get => this._filterByActiveView;
        set {
            if (this._filterByActiveView == value) return;
            this._filterByActiveView = value;
            this.OnPropertyChanged();
        }
    }

    /// <summary>
    ///     When null (default), all categories are shown.
    ///     When set, only instances of the selected category are shown.
    /// </summary>
    public string? SelectedCategory {
        get => this._selectedCategory;
        set {
            if (this._selectedCategory == value) return;
            this._selectedCategory = value;
            this.OnPropertyChanged();
            this.OnPropertyChanged(nameof(this.SelectedFilterValue));
        }
    }

    /// <summary>
    ///     Alias for SelectedCategory to work with FilterBox component.
    /// </summary>
    public string? SelectedFilterValue {
        get => this.SelectedCategory;
        set => this.SelectedCategory = value;
    }

    public event PropertyChangedEventHandler? PropertyChanged;

    protected virtual void OnPropertyChanged([CallerMemberName] string? propertyName = null) =>
        this.PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(propertyName));
}