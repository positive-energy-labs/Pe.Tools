# Background

I just made some refactors and feature additions for
@source/Pe.App/Commands/Palette/CmdPltFamilies.cs (in the two previous commits
too). However i want to change course to a different setup

- one family palette that has three tabs: family, family type, family instance.
  In each:
  - Family:
    - Filter: Category filter
    - Preview: Basic info
    - Action menu:
      - Family Types (opens this same palette but just to the type tab,
        effectively to the next tab for the user)
      - Open/Edit (opens the family in the family editor)
      - Snoop
  - Family Type:
    - Filter: Family filter
    - Preview: Basic info and Parameters (both type and instance) values)
    - Action menu:
      - Place
      - Open/Edit (opens the family in the family editor to this family type)
      - Snoop
      - Inspect Intances (opens this palette to the instance tab)
  - Family Instance:
    - Filter: Family type filter
    - Preview: Basic info and Parameters (both type and instance)
    - Action menu:
      - Snoop

- The other palette would be specifically for family documents and would be all
  the elements of the family. Parameters arae not elements but for the purpose
  of this palette, it doesn't matter. Its just a way to explore familiesand
  their reference planes, dimensions, and connectors, etc.

For palette number 1 (the true family palette), It should be a Split button like
the view palettes.
