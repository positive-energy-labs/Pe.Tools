# Hydronic Pod

Open `page:@hydronic/pages/sizing`. The Page reads `mep.system.members` and `mep.segment.sizes`, calculates candidate diameters using `pages/sizing/size.mjs`, and keeps limits, choices, readings and receipts in its event log. `pages/sizing/Heal.cs` applies chosen diameters through `pe.diff` and refuses changed current diameters or a changed binding.

Water at 60 °C and commercial steel are the calculation assumptions. Firm `Settings/hydronic.json` loading and marked pictures remain owed; local defaults are explicitly 400 Pa/m and 1.5 m/s. There is no kernel Work, Sheet, Goal or app History for this Page. Old route Work stays on disk without a reader. See ADR 0045.
