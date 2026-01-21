# Schedule Title Style Configuration

This document describes how to configure schedule title cell styling, including
borders and text alignment.

## Overview

The `ScheduleTitleStyleSpec` class provides control over:

- **Horizontal alignment** of title text (Left, Center, Right)
- **Individual border edges** with specific line styles for each edge (Top,
  Bottom, Left, Right)

**Important**: Title styles must be applied BEFORE view templates, as view
templates may override cell styles.

## API Components

### `ScheduleTitleStyleSpec`

Main specification for title styling.

**Properties:**

- `HorizontalAlignment` (nullable): Text alignment (Left, Center, Right)
- `BorderStyle` (nullable): Border configuration via `TitleBorderStyleSpec`

### `TitleBorderStyleSpec`

Specification for individual border edges.

**Properties:**

- `TopLineStyleName` (nullable): Line style for top border. If `null`, border is
  explicitly removed (set to invisible).
- `BottomLineStyleName` (nullable): Line style for bottom border. If `null`,
  border is explicitly removed (set to invisible).
- `LeftLineStyleName` (nullable): Line style for left border. If `null`, border
  is explicitly removed (set to invisible).
- `RightLineStyleName` (nullable): Line style for right border. If `null`,
  border is explicitly removed (set to invisible).

**Important**: When a `BorderStyle` is specified, all four edges are explicitly
set. Edges with `null` values are set to invisible (no border), ensuring only
specified borders appear.

### `TitleHorizontalAlignment` enum

- `Left`
- `Center`
- `Right`

## Usage in ScheduleSpec

### Example 1: Title with All Borders and Center Alignment

```json
{
  "Name": "Mechanical Equipment Schedule",
  "CategoryName": "Mechanical Equipment",
  "IsItemized": true,
  "Fields": [...],
  "TitleStyle": {
    "HorizontalAlignment": "Center",
    "BorderStyle": {
      "TopLineStyleName": "Heavy Line",
      "BottomLineStyleName": "Heavy Line",
      "LeftLineStyleName": "Thin Lines",
      "RightLineStyleName": "Thin Lines"
    }
  },
  "ViewTemplateName": "M - Equipment"
}
```

### Example 2: Title with Only Top and Bottom Borders

```json
{
  "Name": "Door Schedule",
  "CategoryName": "Doors",
  "IsItemized": true,
  "Fields": [...],
  "TitleStyle": {
    "HorizontalAlignment": "Left",
    "BorderStyle": {
      "TopLineStyleName": "Wide Lines",
      "BottomLineStyleName": "Wide Lines"
    }
  }
}
```

### Example 3: Alignment Only (No Borders)

```json
{
  "Name": "Room Schedule",
  "CategoryName": "Rooms",
  "IsItemized": true,
  "Fields": [...],
  "TitleStyle": {
    "HorizontalAlignment": "Right"
  }
}
```

### Example 4: Borders Only (No Alignment Override)

```json
{
  "Name": "Window Schedule",
  "CategoryName": "Windows",
  "IsItemized": true,
  "Fields": [...],
  "TitleStyle": {
    "BorderStyle": {
      "TopLineStyleName": "Thin Lines",
      "BottomLineStyleName": "Thin Lines",
      "LeftLineStyleName": "Thin Lines",
      "RightLineStyleName": "Thin Lines"
    }
  }
}
```

## Line Style Names

Line styles must match the line styles defined in your Revit project. Common
line style names include:

- `"Thin Lines"`
- `"Wide Lines"`
- `"Heavy Line"`
- `"Medium Lines"`
- `"<Invisible lines>"`

You can find line styles in Revit at: **Manage > Additional Settings > Line
Styles**

## Serialization

The `ScheduleTitleStyleSpec.SerializeFrom(ViewSchedule)` method captures
existing title styles from a schedule:

- Only serializes overridden properties
- Returns `null` if no title style overrides exist
- Reads border styles for each edge independently
- Captures horizontal alignment if overridden

## Application

The `ScheduleTitleStyleSpec.ApplyTo(ViewSchedule)` method applies title styles
to a schedule:

- Only applies non-null properties
- Sets appropriate override flags in `TableCellStyleOverrideOptions`
- Returns a tuple with success status and warning messages
- Validates that the title cell exists and allows style overrides

## Revit API Mapping

| ScheduleSpec Property             | Revit API Property                       | Notes                                |
| --------------------------------- | ---------------------------------------- | ------------------------------------ |
| `HorizontalAlignment`             | `TableCellStyle.FontHorizontalAlignment` | Uses `HorizontalAlignmentStyle` enum |
| `BorderStyle.TopLineStyleName`    | `TableCellStyle.BorderTopLineStyle`      | ElementId of GraphicsStyle           |
| `BorderStyle.BottomLineStyleName` | `TableCellStyle.BorderBottomLineStyle`   | ElementId of GraphicsStyle           |
| `BorderStyle.LeftLineStyleName`   | `TableCellStyle.BorderLeftLineStyle`     | ElementId of GraphicsStyle           |
| `BorderStyle.RightLineStyleName`  | `TableCellStyle.BorderRightLineStyle`    | ElementId of GraphicsStyle           |

## Common Pitfalls

1. **View Template Override**: Always apply title styles BEFORE applying view
   templates, or the view template may override your settings.

2. **Invalid Line Styles**: If a line style name doesn't exist, the border won't
   be applied, but a warning will be logged.

3. **Hidden Title Section**: If the schedule's title section is hidden, title
   styles cannot be applied.

4. **Cell Style Overrides Disabled**: Some schedules may not allow cell style
   overrides on the title cell.

5. **Border Behavior**: When you specify a `BorderStyle`, ALL four edges are
   explicitly set. Any edge with a `null` line style name will be set to
   invisible (no border). This ensures only the borders you specify appear,
   overriding any default table styling.

## Code Example (C#)

```csharp
var spec = new ScheduleSpec {
    Name = "Equipment Schedule",
    CategoryName = "Mechanical Equipment",
    IsItemized = true,
    Fields = [...],
    TitleStyle = new ScheduleTitleStyleSpec {
        HorizontalAlignment = TitleHorizontalAlignment.Center,
        BorderStyle = new TitleBorderStyleSpec {
            TopLineStyleName = "Heavy Line",
            BottomLineStyleName = "Heavy Line",
            LeftLineStyleName = "Thin Lines",
            RightLineStyleName = "Thin Lines"
        }
    },
    ViewTemplateName = "M - Equipment"
};

var result = ScheduleHelper.CreateSchedule(doc, spec);

// Check for warnings
if (result.Warnings.Count > 0) {
    foreach (var warning in result.Warnings) {
        Console.WriteLine($"Warning: {warning}");
    }
}
```

## Testing

To test title style functionality:

1. Create a schedule with `TitleStyle` configuration
2. Open the schedule in Revit
3. Right-click the title cell and select "Text" to verify formatting
4. Right-click the title cell and select "Borders" to verify border styles
5. Ensure borders appear on the correct edges with the correct line styles
