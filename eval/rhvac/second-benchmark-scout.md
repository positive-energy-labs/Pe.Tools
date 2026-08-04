# RHVAC second benchmark scout

Date: 2026-08-05  
Scope: read-only sweep of `G:\Shared drives\PE Team Folder`

## Recommendation

Use **project-b Architecture / project-b Residence** as the second benchmark.

It is the cleanest anti-overfitting complement to projectA: a current single-family project, 22 RHVAC rooms over about 4,958 ft2, one strongly annotated Bluebeam takeoff sheet with 23 area measurements, and a matching linked Revit model. It is ordinary enough to expose regressions that a project-a-tuned detector could hide.

If adding two ordinary projects, add **GA Nunlee / Deer Path Residence** next. Its 26 RHVAC rooms and 26 Bluebeam area measurements make it an unusually clean current oracle. **GRCH / Patel Residence** is the best third, medium-size bridge, but at 41 rooms and about 12,994 ft2 it is less ordinary.

### Ranked top 3

1. **project-b Residence** - best overall: 22 rooms, 4,958 ft2, 2025 artifacts, 23 area markups for 22 RHVAC rooms, and a matching 114 MB Revit link.
2. **Deer Path Residence** - best second ordinary case: 26 rooms, 4,505 ft2, 2026 RHVAC/Revit evidence, and exactly 26 area markups plus 88 length measurements.
3. **Patel Residence** - best medium bridge: 41 rooms, 12,994 ft2, 59 area markups across six pages, current RHVAC, and a substantive architectural Revit link.

## Top 3 artifact detail

### 1. project-b Residence

- Project: `G:\Shared drives\PE Team Folder\project-b Architecture\project-b Residence`
- RHVAC: `G:\Shared drives\PE Team Folder\project-b Architecture\project-b Residence\02_Mechanical\ManJ_ProjectB_2025.05.20 - CJ.r10`
  - 2,390,016 bytes; modified 2025-07-11.
  - Read-only Jet query: 22 rooms, about 4,958 ft2, 8 systems.
- Takeoff PDF: `G:\Shared drives\PE Team Folder\project-b Architecture\project-b Residence\02_Mechanical\M Takeoffs_ProjectB_2025.02.18.pdf`
  - 1 PDF; 15,869,638 bytes; modified 2025-02-26.
  - 134 pages; all 26 measured annotations are on page 2: 23 area and 3 length.
  - Visual check shows explicit colored room/zone polygons over the residential plan.
- Revit: `G:\Shared drives\PE Team Folder\project-b Architecture\project-b Residence\05_Revit\Links\ProjectB_R25_2025.05.10.rvt`
  - 114,003,968 bytes; modified 2025-08-15.
  - Matching original architecture copy also exists under `01_Originals\2025.05.10 Arch RVT\projectB.rvt`.
- Rough scale: small, ordinary single-family; materially simpler than projectA.

### 2. Deer Path Residence

- Project: `G:\Shared drives\PE Team Folder\GA Nunlee\Deer Path Residence`
- RHVAC: `G:\Shared drives\PE Team Folder\GA Nunlee\Deer Path Residence\02_Mechanical\ManJ_GA Nunlee_Deer Path Residence_T24 Updates_2025.12.02.r10`
  - 2,215,936 bytes; modified 2026-04-24.
  - Read-only Jet query: 26 rooms, about 4,505 ft2, 7 systems.
- Takeoff PDF: `G:\Shared drives\PE Team Folder\GA Nunlee\Deer Path Residence\02_Mechanical\2025.08.20_3144 SPRUANCE RD_KP_With Takeoffs.pdf`
  - 1 PDF; 45,091,510 bytes; modified 2025-10-23.
  - 28 pages; 114 measured annotations: 26 area and 88 length. All area measurements are on page 15.
  - Visual check shows room-by-room measurement outlines over a main residence plus a small ADU.
- Revit: `G:\Shared drives\PE Team Folder\GA Nunlee\Deer Path Residence\01_Originals\2026.04.07 Permit Markups PDF, Arch Updates IFC, CAD, PDF\2026-04-06_OUT_CD01 CAD+3D+PDFs\DeerPath_2026.05.07.rvt`
  - 53,682,176 bytes; modified 2026-05-08.
  - A matching linked model also exists under `05_Revit\Links`.
- Rough scale: small-to-medium single-family; still a clear ordinary lane despite the ADU.

### 3. Patel Residence

- Project: `G:\Shared drives\PE Team Folder\GRCH Architecture\Patel Residence`
- RHVAC: `G:\Shared drives\PE Team Folder\GRCH Architecture\Patel Residence\02_Mechanical\ManJ_GRCH.Architecture_Patel.Residence_2026.02.02.r10`
  - 2,224,128 bytes; modified 2026-02-07.
  - Read-only Jet query: 41 rooms, about 12,994 ft2, 7 systems.
- Takeoff PDF: `G:\Shared drives\PE Team Folder\GRCH Architecture\Patel Residence\02_Mechanical\Takeoffs-MEP_GRCH_Kickoff Plan Set_Consolidated.pdf`
  - 1 PDF; 3,374,832 bytes; modified 2025-07-30.
  - 8 pages; 147 measured annotations: 59 area and 88 length, spread across six pages.
- Revit: `G:\Shared drives\PE Team Folder\GRCH Architecture\Patel Residence\05_Revit\Links\GRCH_Patel_R25_2025.11.24.rvt`
  - 213,434,368 bytes; modified 2025-11-25.
  - Matching original: `01_Originals\2025.11.24 RVT\Patel_Foxhunt_Final.rvt`.
- Rough scale: medium single-family; useful between the ordinary pair and projectA.

## Coverage and qualification

- Broad pass: 368 level-1 folders and 1,664 level-2 folders.
- Targeted descent: reconstructed each project root before standard section folders such as `02_Mechanical`, `03_Mechanical`, legacy `Mechanical`, `ManJ`, `ManS`, `RVT`, `From Architect`, and `05_Revit`.
- Takeoff search: case-insensitive `.pdf` whose Mechanical/ManJ/RHVAC path contained `take.?offs?` in any path segment, including the filename. This matters because projectB, Deer Path, Patel, and McKenzie store Takeoff-named PDFs directly under `02_Mechanical`.
- RHVAC gate: a current non-archive, non-template `.r10`.
- Revit gate: a substantive non-placeholder `.rvt` or matching Revit link/folder.
- Bluebeam gate: at least one PDF with `/Measure`, dimension intent, or a Measurement subject. All 45 non-project-a metadata candidates passed this object-level check; zero projects were unreadable.
- Six projects required a second PDF because the smallest apparent takeoff was only a reference set: Cleremont Core, Farm Center, Pasture Pavilion, Ross Cabins, Smith Residence, and Helena Vinedo.

**Fully qualified total: 46 projects including projectA, or 45 alternatives to projectA.**

project-a baseline artifacts remain:

- RHVAC: `G:\Shared drives\PE Team Folder\ArchitectA Architects\project-a Residence\02_Mechanical\CD100_ManJ_ArchitectA_ProjectA_2026.03.30.r10` - 9,824,256 bytes, modified 2026-07-16.
- Takeoffs: `G:\Shared drives\PE Team Folder\ArchitectA Architects\project-a Residence\02_Mechanical\Takeoffs` - 10 PDFs dated 2024-06-01 through 2026-04-01.
- Revit: `G:\Shared drives\PE Team Folder\ArchitectA Architects\project-a Residence\05_Revit`.
- Known scale: 150 RHVAC rooms across 5 levels.

## Other strong candidates, ranks 4-10

4. **project-d** - `G:\Shared drives\PE Team Folder\Polaris High Performance Homes\project-d`
   - RHVAC: `02_Mechanical\ManJ_ArchitectBOffice_project-d_2026.04.03.r10`; 831,488 bytes; 2026-04-08.
   - Takeoffs: 2 PDFs dated 2026-03-24 through 2026-04-04; verified `02_Mechanical\2026.04.03 Updated project-d Takeoffs.pdf`, but only 4 measurements.
   - Revit: `01_Originals\2026.04.02 Arch RVT\MEP-ArchitectB_project-d_2026.04.02.rvt`.
   - Rough scale: very small; verify the four measurements cover the intended scope before promotion.
5. **2525 Belmont** - `G:\Shared drives\PE Team Folder\Fowlkes Studio\2525 Belmont`
   - RHVAC: `02_Mechanical\ManJ_FowlkesStudio_Belmont_20250619_70F summer & 72F winter.r10`; 1,048,576 bytes; 2026-07-30.
   - Takeoffs: 5 PDFs dated 2024-09-23 through 2026-06-23; verified `02_Mechanical\Takeoffs\250616 2525 Belmont Floor Plans_ELC Takeoffs.pdf`, 73 area measurements.
   - Revit: `08_Submissions\2026.06.23 CD100\MEP_Fowlkes Studio_2525 Belmont_R23_Client.rvt`.
   - Rough scale: 73 RHVAC rooms, about 17,445 ft2; medium-large but much smaller than projectA.
6. **McKenzie Residence** - `G:\Shared drives\PE Team Folder\Hsu Office of Architecture\McKenzie Residence`
   - RHVAC: `02_Mechanical\ManJ_HsuArchitecture_Mckenzie_2025.05.08_ReZoned (Update by thetran).r10`; 2,656,256 bytes; 2026-07-17.
   - Takeoff: `02_Mechanical\20250319_McKenzie Permit Set_Draft_TAKEOFFS.pdf`; 1 PDF, 2025-05-21, 116 measurements including 42 areas.
   - Revit: `08_Submissions\2026.08.04 Rev 3\M_Hsu_McKenzie Residence_R24_Client_2026.08.04.rvt`.
   - Rough scale: small-medium.
7. **Hatley Drive Residence** - `G:\Shared drives\PE Team Folder\Winn Wittman Architecture\Hatley Drive Residence`
   - RHVAC: `02_Mechanical\ManJ_WinnWittmanArchitecture_HatleyDriveResidence_2025.08.11.r10`; 1,439,744 bytes; 2025-10-11.
   - Takeoff: `02_Mechanical\25_0522-Hatley-Permit set_Takeoffs..pdf`; 1 PDF, 2025-06-13, 246 measurements.
   - Revit: `01_Originals\2025.07.24 Arch IFC\20250722_3019 Hatley DR.rvt`.
   - Rough scale: medium-large annotation set.
8. **Eason** - `G:\Shared drives\PE Team Folder\Forge Craft Architecture\Eason`
   - RHVAC: `02_Mechanical\ManJ_ForgeCraft_Eason_2025.03.25.r10`; 1,361,920 bytes; 2026-02-01.
   - Takeoff: `02_Mechanical\Take offs\260109_EASON TRIPLEX_CDs_ELC.pdf`; 1 PDF, 2026-01-31, 37 measurements.
   - Revit: `05_Revit\Links\Link_260610_Eason Triplex.ifc.RVT`.
   - Rough scale: 45 RHVAC rooms, about 6,033 ft2; a triplex rather than ordinary single-family.
9. **Cleremont - Ross Cabins** - `G:\Shared drives\PE Team Folder\Brodie Group\Cleremont - Ross Cabins`
   - RHVAC: `02_Mechanical\ManJ_Lake Flato_Cleremont Ross Cabins_2026.07.09.R2025.r10`; 1,564,672 bytes; 2026-07-16.
   - Takeoffs: 7 PDFs dated 2026-04-09 through 2026-07-18; verified `02_Mechanical\2026.07.08 Updated Takeoffs\3 BDRMpdf.pdf`, 6 measurements.
   - Revit: `01_Originals\2026.07.28 Arch RVT\2026.07.28_ROSS_3 BED_R25.rvt`.
   - Rough scale: 45 RHVAC rooms, about 10,205 ft2 across several cabin types; less ordinary.
10. **Park Lane** - `G:\Shared drives\PE Team Folder\Holm Studios\Park Lane`
   - RHVAC: `02_Mechanical\ManJ_HolmStudios_ParkLane_2026.06.08_Skylights_CC.r10`; 3,678,208 bytes; 2026-06-09.
   - Takeoffs: 2 PDFs dated 2026-01-24 through 2026-04-21; verified `02_Mechanical\takeoffs - 2026 01 13 Park Lane Plans.pdf`, only 3 measurements.
   - Revit: `05_Revit\Links\Copy of Revit file from 04.09.2026\Holm_ParkLane_R26_2026.04.09.rvt`.
   - Rough scale: large model and weak measurement coverage; poor ordinary fit.

## Remaining 35 fully qualified alternatives

Each line gives the selected RHVAC file, verified takeoff PDF/count/date range, representative Revit path, and a rough scale signal. Scale tags are based on measurement count and `.r10` size unless a live Jet count was queried; no Revit model was opened.

- **Aidlin Darling Design / Driftwood Residence** - RHVAC `G:\Shared drives\PE Team Folder\Aidlin Darling Design\Driftwood Residence\02_Mechanical\ManJ_AidlinDarling_Magaro2.0_2025.02.05 updated wine room and AV.r10`, 3,700,736 B, 2026-02-28; 1 PDF, 2023-06-27, verified `...\Driftwood SD Background Plans_TAKEOFFS.pdf` with 213 measurements; RVT `...\01_Originals\20251005 Arch model\2106_2-Driftwood_CD\2106_2_Driftwood_Struct_R24.rvt`; large.
- **Alpine OR / Dodge Point, Woodland Cottage lane** - RHVAC `G:\Shared drives\PE Team Folder\Alpine OR\Dodge Point\02_Mechanical\ManJ_Alpine_Dodge Point_Woodland Cottage_20241016_JD.r10`, 1,071,104 B, 2026-04-13; 1 PDF, 2024-08-20, verified `...\Takeoffs\23003_BUILDING 4_WOODLAND COTTAGE_ELC.pdf` with 20 measurements; matching RVT `...\08_Submissions\20251116 RVT Models to NHB\MEP_Alpine_DodgePoint_Woodland Cottage_R24_20251116.rvt`; read-only Jet query found 24 rooms and about 4,655 ft2. A 1.96 GB matching architectural source RVT also exists.
- **Artisans Group / Boulevard** - RHVAC `G:\Shared drives\PE Team Folder\Artisans Group\Boulevard\02_Mechanical\ManJ_Artisans Group_H4H Boulevard_One-Story Townhomes_Wall Heads_ELC.r10`, 997,376 B, 2026-04-05; 4 PDFs, 2023-11-09 through 2023-11-22, verified `...\Man J Takeoffs\H4HBLVD Senior TH_SD PROGRESS SET_20230919_Takeoffs - ELC.pdf` with 42 measurements; RVT `...\01_Originals\20260416 Arch & Struct RVT (Downloaded from ShareFile 20260526)\260427_H4HBLVD_SITE_PERMIT MODEL.rvt`; small-medium townhomes.
- **Brodie Group / Cleremont - Core** - RHVAC `G:\Shared drives\PE Team Folder\Brodie Group\Cleremont - Core\02_Mechanical\ManJ_Bordie_Cleremont_w kitchen DOAS_2026.03.10.r10`, 2,650,112 B, 2026-03-13; 2 PDFs, 2024-09-05 through 2024-09-06, verified `...\240806 Cleremont Core 50% DD - Accessory Buildings_Takeoff.pdf` with 127 measurements; RVT `...\01_Originals\2024.08.09 Arch DWGs\As Builts\VA01-76638-Cleremont-Farms_Revit-DWG-PDF\3D Model\VA01-76638-Cleremont-Farms_Revit Model 2-1.rvt`; medium-large.
- **Brodie Group / Cleremont - Farm Center** - RHVAC `G:\Shared drives\PE Team Folder\Brodie Group\Cleremont - Farm Center\02_Mechanical\ManJ_Brodie_Cleremont Farm Center_2026.02.10.r10`, 1,366,016 B, 2026-02-13; 8 PDFs, 2025-11-12 through 2026-02-10, verified `...\Takeoff\FC_Farm Office_2025.11.11.pdf` with 43 measurements; RVT `...\05_Revit\Links\FC_Farm Office_R24_detached_2026.02.09.rvt`; 27 RHVAC rooms and about 8,980 ft2, but a multi-building farm program.
- **Brodie Group / Cleremont - Pasture Pavilion** - RHVAC `G:\Shared drives\PE Team Folder\Brodie Group\Cleremont - Pasture Pavilion\02_Mechanical\ManJ_Bordie_Cleremont Pavilion_2025.05.27.r10`, 1,556,480 B, 2026-02-12; 3 PDFs, 2025-03-29 through 2025-03-30, verified `...\Takeoffs\PP_DINING_R24.pdf` with 31 measurements; RVT `...\01_Originals\2026.02.18 Arch RVT\2026_0218_Pasture Pavilion\PP_DINING_R24\PP_SHED_R24.rvt`; 40 rooms and about 13,072 ft2, not ordinary residential.
- **Charles Di Piazza Architecture / 701 Baylor** - RHVAC `G:\Shared drives\PE Team Folder\Charles Di Piazza Architecture\701 Baylor\02_Mechanical\ManJ_CDP_Baylor_20240719.r10`, 935,936 B, 2025-05-22; 1 PDF, 2024-07-21, verified `...\240709_BAYLOR_DD - Mechanical Takeoffs.pdf` with 40 measurements; RVT `...\01_Originals\2025.04.14 Arch RVT and PDF Set\250415_BAYLOR_MEP BACKGROUND_R24.rvt`; small-medium.
- **Clayton Korte / Woody Residence 211 Reveille** - RHVAC `G:\Shared drives\PE Team Folder\Clayton Korte\Woody Residence 211 Reveille\03_Mechanical\ManJ_Clayton Little_Woody Residence_20240917.r10`, 835,584 B, 2024-10-02; 1 PDF, 2024-09-18, verified `...\20005_211 Reveille_CD_Takeoff.pdf` with 52 measurements; RVT `...\09_Revit\Links\20005_211 Reveille_CD_R20_CONSOLIDATED.rvt`; small-medium.
- **Dowbuilt / Chance Residence 2611 Westlake** - RHVAC `G:\Shared drives\PE Team Folder\Dowbuilt\Chance Residence_2611 Westlake\02_Mechanical\ManJ_Dowbuilt_Chance Residence_2611 Westlake_20240412.r10`, 1,304,576 B, 2024-04-17; 2 PDFs, 2024-02-22 through 2024-04-16, verified `...\Takeoffs_Dowbuilt_Chance Residence_2611 Westlake_20240412.pdf` with 53 measurements; RVT `...\01_Originals\20240708 Studio Luck Revit Model\Westlake Drive - Architecture - 2024.07.05.rvt`; small-medium.
- **Dumican Mosey / Rio West** - RHVAC `G:\Shared drives\PE Team Folder\Dumican Mosey\Rio West\02_Mechanical\Type E\ManJ_Dumican Mosey_Rio West Type EA31.2_20240408.r10`, 886,784 B, 2024-04-12; 4 PDFs, 2023-11-29 through 2024-04-09, verified `...\Type C\Takeoffs_Dumican Mosey_Rio West Type C_20240305.pdf` with 15 measurements; RVT `...\05_Revit\M_DumicanMosey_RioWestCustomE_R24_Published.rvt`; small.
- **Farmer Payne Architects / Martin Residence** - RHVAC `G:\Shared drives\PE Team Folder\Farmer Payne Architects\Martin Residence\02_Mechanical\ManJ_Farmer Payne_Martin_20240531.r10`, 1,251,328 B, 2024-07-02; 1 PDF, 2024-07-03, verified `...\Martin_100%CD_221227 - Takeoffs Copy.pdf` with 228 measurements; RVT `...\05_Revit\Links\Martin Residence_240126 - Copy 20240429.ifc.RVT`; large annotation set.
- **Feldman / Griffith Residence** - RHVAC `G:\Shared drives\PE Team Folder\Feldman\Griffith Residence\02_Mechanical\ManJ_Feldman_Griffith_2025.03.28_Salinas Weather - CC Edits.r10`, 1,607,680 B, 2026-03-06; 2 PDFs, 2025-01-09 through 2025-08-23, verified `...\2025.08.05_1RT_Background._TAKEOFFSpdf.pdf` with 112 measurements; RVT `...\01_Originals\2025.12.03 CD95 & Revit\2025.12.02_1 RT.rvt`; medium.
- **Feldman / Ward Residence** - RHVAC `G:\Shared drives\PE Team Folder\Feldman\Ward Residence\02_Mechanical\ManJ_Feldman_Ward Residence_2025.05.10.r10`, 1,198,080 B, 2025-08-26; 1 PDF, 2025-04-14, verified `...\Takeoffs\2025.04.04_Ward - 75% DD_Takeoffs.pdf` with 101 measurements; RVT `...\01_Originals\2026.01.29 Arch PDF and RVT\2026.01.15_Ward Revit.rvt`; 31 rooms and about 5,979 ft2, an excellent alternate ordinary lane.
- **Field Architecture / Bell Road** - RHVAC `G:\Shared drives\PE Team Folder\Field Architecture\Bell Road\02_Mechanical\ManJ_Field Architects_Bell Rd_20240819.r10`, 1,968,128 B, 2026-06-17; 1 PDF, 2024-08-20, verified `...\240718_BEL - DD Draft Set_24x36-takeoffs.pdf` with 33 measurements; RVT `...\01_Originals\2024.10.01 Arch RVT from BIM360\BEL_Arch.rvt`; small-medium.
- **Forge Craft Architecture / 5908 Mountain Climb** - RHVAC `G:\Shared drives\PE Team Folder\Forge Craft Architecture\5908 Mountain Climb\02_Mechanical\ManJ_ForgeCraftArchitecture_5908MountainClimb_2025_12_04.r10`, 942,080 B, 2026-02-17; 1 PDF, 2023-10-17, verified `...\Mountainclimb Residence-SD Pricing-071923 Takeoffs.pdf` with 98 measurements; RVT `...\01_Originals\20251003 - Arch RVT & PDFs\251003_Mountainclimb.rvt`; medium.
- **project-b Architecture / Tahitian Village** - RHVAC `G:\Shared drives\PE Team Folder\project-b Architecture\Tahitian Village\02_Mechanical\ManJ_project-b Architects_Tahitian Village_CD_20251030_PH update_ERV-TMDD.r10`, 1,355,776 B, 2025-12-03; 1 PDF, 2024-08-02, verified `...\Bastrop_Passive-take offs ERG.pdf` with 30 measurements; RVT `...\05_Revit\Links\Bastrop_Passive 08.27.2024_R25.rvt`; small.
- **J Christopher Architecture / Weinzierl - Boot Ranch Tuscan** - RHVAC `G:\Shared drives\PE Team Folder\J Christopher Architecture\Weinzierl - Boot Ranch Tuscan\02_Mechanical\Equipment Cutsheets\ManJ_J Christopher_Boot Ranch Tuscan_2024.08.19_72 Cooling SetPoint.r10`, 2,686,976 B, 2025-09-11; 1 PDF, 2024-09-23, verified `...\Take-offs_J Christopher_Boot Ranch Tuscan_08192024.pdf` with 56 measurements; RVT `...\01_Originals\20240920 - Arch RVT and PDF\Copy of Weinzierl--Boot Ranch Tuscan_09.20.24.rvt`; small-medium.
- **John Fitzpatrick Architects / Britton Residence** - RHVAC `G:\Shared drives\PE Team Folder\John Fitzpatrick Architects\Britton Residence\02_Mechanical\Post CD - Changes\ManJ_John Fitzpatrick_Britton Residence_2025.09.03_CD_NZ.r10`, 2,457,600 B, 2025-09-15; 1 PDF, 2024-06-21, verified `...\5-20-24 - 3302 Park Hills DR - sh 1 to 25_Takeoff_OM.pdf` with 42 measurements; RVT `...\05_Revit\Links\5-20-24 - 3302 Park Hills DR.ifc.RVT`; small-medium.
- **Kapstone Design Build / Cargo House** - RHVAC `G:\Shared drives\PE Team Folder\Kapstone Design Build\Cargo House\02_Mechanical\ManJ_Kapstone_Cargo_2025.04.11.r10`, 1,067,008 B, 2025-09-16; 1 PDF, 2025-04-22, verified `...\5916 MASTER 1218._TAKEOFFSpdf.pdf` with 121 measurements; RVT `...\01_Originals\2025.05.16 Arch RVT & Enscape\5916 Master 0516.rvt`; medium-large.
- **Larue Architecture / Ocotillo - Lajitas** - RHVAC `G:\Shared drives\PE Team Folder\Larue Architecture\Ocotillo - Lajitas\02_Mechanical\ManJ_Larue_Ocotillo_20240516_OM.r10`, 1,681,408 B, 2025-02-14; 1 archived PDF, 2024-01-26, verified `...\Archive\20240103_Warren-Lajitas_TAKEOFFS.pdf` with 42 measurements; RVT `...\01_Originals\20241231 Arch RVT and PDF\2024.12.31_Las Montanas Residence.rvt`; small-medium.
- **MW Works / Fern Prairie** - RHVAC `G:\Shared drives\PE Team Folder\MW Works\Fern Prairie\02_Mechanical\R454B\ManJ_MW Works_Fern Prairie_2025.10.10 - Lighting Loads - Based on lighting package.r10`, 3,504,128 B, 2026-07-09; 1 PDF, 2024-11-17, verified `...\Takeoffs\2024_1017 Fern Prairie DD Progress_Takeoffs.pdf` with 85 measurements; RVT `...\05_Revit\Links\Link_2305_Fern Prairie_CD_RVT25_2026.05.14.rvt`; 52 rooms and about 12,383 ft2, medium-large.
- **Medium Plenty / Tuscaloosa (Kaul Residence)** - RHVAC `G:\Shared drives\PE Team Folder\Medium Plenty\Tuscaloosa (Kaul Residence in Atherton, CA)\02_Mechanical\ManJ_MediumPlenty_Atherton_20240906_RH10_20240918_VE.r10`, 980,992 B, 2024-09-20; 2 PDFs, 2024-04-02 through 2024-04-21, verified `...\Takeoffs\20240329_2305 Tuscaloosa_Arch-Plans_ELC.pdf` with 25 measurements; RVT `...\01_Originals\20240918 Arch Updated Revit Model Gym\2305 TUSCALOOSA AVE_CM_2024-9-17_22.8.45\2305 TUSCALOOSA AVE_POOL_HOUSE_CM.rvt`; 13-room, 1,774 ft2 gym/spa subset rather than a whole ordinary house.
- **Meier Architects / Hanalei Bluff** - RHVAC `G:\Shared drives\PE Team Folder\Meier Architects\Hanalei Bluff\02_Mechanical\ManJ_Meier_Hanalei Bluff_2026.03.19 Windows.r10`, 2,398,208 B, 2026-03-20; 2 PDFs, 2024-06-27 through 2026-02-18, verified `...\Takeoffs\240712_Bluff House Background Set + MEP Markups.pdf` with 21 measurements; RVT `...\01_Originals\2025.12.08 Arch IFC RVT\2025-11-26 HANALEI BLUFF HOUSE.ifc.RVT`; 26 rooms and about 6,335 ft2, but only 11 area polygons in the sampled PDF.
- **Natalye Appel Architect / Sul Ross Residence** - RHVAC `G:\Shared drives\PE Team Folder\Natalye Appel Architect\Sul Ross Residence - Houston - Texas\02_Mechanical\ManJ_NatalyeAppel_Sul Ross_2025.09.11(70.75)_EG.r10`, 1,513,472 B, 2026-02-05; 1 PDF, 2024-11-22, verified `...\TAKEOFFS_Sul Ross_DD241101_20241112.pdf` with 29 measurements; RVT `...\05_Revit\Links\Sul CD-2506011.rvt`; small.
- **Olson Kundig / DeVoe Residence** - RHVAC `G:\Shared drives\PE Team Folder\Olson Kundig\DeVoe Residence\02_Mechanical\ManJ_Olson Kundig_DeVoe_20240816_ELC.r10`, 1,064,960 B, 2024-12-19; 1 PDF, 2024-08-18, verified `...\Takeoffs\2024.08.12 Devoe Residence DD Progress Set_ELC Takeoffs.pdf` with 67 measurements; matching architectural RVT `...\01_Originals\20240815 Arch RVT PDF Appliance Schedule\20072-DeVoe Lopez Island-Little Tree-ARCH-R2023.rvt`; 20 rooms and about 3,887 ft2, strongest older fallback.
- **Penniman Architects / Birchfell Residence** - RHVAC `G:\Shared drives\PE Team Folder\Penniman Architects\Birchfell Residence\02_Mechanical\ManJ_Penniman_Birchfell_20250204 - Main House_LMB.r10`, 921,600 B, 2026-05-15; 2 PDFs, 2023-11-04 through 2026-02-26, verified `...\2314 2023-1005 Progress Set - Copy for Takeoffs (Loren Muirhead's conflicted copy 2023-11-06).pdf` with 164 measurements; RVT `...\05_Revit\Links\Archived Revit Version.rvt`; medium-large.
- **RIOS / Foxtail Residence** - RHVAC `G:\Shared drives\PE Team Folder\RIOS\Foxtail Residence\02_Mechanical\ManJ_RIOS_Foxtail_2026.03.05_TheaterUpdates_CJ.r10`, 2,463,744 B, 2026-03-06; 2 PDFs, 2024-10-30 through 2024-12-12, verified `...\241018_Foxtail Residence Progress Set - takeoffs for Load Calc.pdf` with 125 measurements; RVT `...\01_Originals\2026.07.06 Arch Rvt Model from BIM360\23076-RIOS-AR-FOXTAIL-R23.rvt`; medium-large.
- **SAMAHA / Petty Residence** - RHVAC `G:\Shared drives\PE Team Folder\SAMAHA\Petty Residence\02_Mechanical\ManJ_SAMAHA_PettyResidence_20240912.r10`, 886,784 B, 2024-09-24; 2 PDFs, 2024-09-18 through 2024-09-19, verified `...\Petty Residence-First Floor Plan-09.06.2024_TAKEOFFS.pdf` with 6 measurements; RVT candidate `...\01_Originals\2024.06.03 Arch floor plan, concept, and structural model\Old Structural Model\3. PLANOS Y MODELO\Winter park V1.rvt`; small but model filename mismatch merits review.
- **Settle Studio / Dolphin Cv** - RHVAC `G:\Shared drives\PE Team Folder\Settle Studio\Dolphin Cv\02_Mechanical\ManJ_SettleStudio_DoplphinPassive_20240229_2 system_Minotair Exp.r10`, 868,352 B, 2025-08-28; 3 PDFs, 2024-03-09 through 2024-04-24, verified `...\3301 Dolphin Cove - Updated Plan_TakeOffs.pdf` with 44 measurements; RVT `...\05_Revit\Links\3301 Dolphin Cove - 20250415.rvt`; small-medium.
- **Steven Baczek Architect / Ardi Residence** - RHVAC `G:\Shared drives\PE Team Folder\Steven Baczek Architect\Ardi Residence\02_Mechanical\ManJ_StevenBaczek_ArdiResidence_20240401.r10`, 1,402,880 B, 2025-02-04; 1 PDF, 2024-06-29, verified `...\23_Ardi-TX_DD1 1-29-24_SET_TAKEOFFS.pdf` with 54 measurements; RVT `...\05_Revit\Archive\M_SteveBaczek_ArdiResidence_R24.rvt`; small-medium.
- **Stuart G Smith / Smith Residence** - RHVAC `G:\Shared drives\PE Team Folder\Stuart G Smith\Smith Residence\02_Mechanical\Takeoffs\ManJ_StuartGSmith_SmithResidence_2024.12.15.r10`, 1,128,448 B, 2025-04-08; 3 PDFs, 2024-09-21 through 2024-10-03, verified `...\Takeoffs\BUZZELL RIDGE RESIDENCE-240918.pdf` with only 1 measurement; RVT `...\01_Originals\2025.03.12 Arch Markups and IFC\Buzzell Ridge Residence-Arch IFC.ifc.RVT`; 16 rooms and about 3,288 ft2, but weak takeoff evidence.
- **Studio Luck / Mad Hippie** - RHVAC `G:\Shared drives\PE Team Folder\Studio Luck\Mad Hippie\02_Mechanical\ManJ_StudioLuck_MadHippie_20251006_v10.r10`, 1,574,912 B, 2025-10-07; 1 PDF, 2022-12-15, verified `...\Mad Hippie - Takeoffs.pdf` with only 2 measurements; RVT `...\01_Originals\20250327 revision files\2025.04.11 - Mad Hippie - Revision 5 Backgrounds.rvt`; weak takeoff evidence.
- **Tory Baughan / Baughan Residence** - RHVAC `G:\Shared drives\PE Team Folder\Tory Baughan\Baughan Residence\02_Mechanical\ManJ_Tory Baughan_Baughan Residence_20230628_updated design temps_RHVACv10 - No Basement.r10`, 1,058,816 B, 2024-01-31; 1 PDF, 2023-08-16, verified `...\Baughan Residence (5_15_23)-takeoffs.pdf` with 91 measurements; RVT `...\05_Revit\M_Tory Baughan_Baughan Residence_R23_No Air zone.rvt`; medium but old.
- **Walker Warner Architects / Helena Vinedo** - RHVAC `G:\Shared drives\PE Team Folder\Walker Warner Architects\Helena Viñedo\02_Mechanical\ManJ_Walker Warner Architects_Helena Vinedo_20240620.r10`, 2,899,968 B, 2025-01-29; 2 PDFs, both 2024-10-19, verified `...\Takeoffs\2024-10-08 Plans.pdf` with only 3 measurements; RVT `...\05_Revit\Links\2025-01-13 HV MH 3D.ifc.RVT`; 45 rooms and about 10,608 ft2, weak takeoff evidence.
- **ArchitectA Architects / Red Cloud - Deer Valley, UT** - RHVAC `G:\Shared drives\PE Team Folder\ArchitectA Architects\Red Cloud - Deer Valley, UT\02_Mechanical\RED CLOUD 2025.12.16_all glass conservatory.r10`, 5,740,544 B, 2026-01-21; 3 PDFs, 2025-12-06 through 2025-12-09, verified `...\A2-2.01_UPPER LEVEL FLOOR PLAN_Takeoffs_JD.pdf` with 25 measurements; RVT `...\05_Revit\Archive\MEP_ArchitectA_Red Cloud Deer Valley_R25.rvt`; large, about 58% of project-a by r10 size.

## Takeoff PDFs but no RHVAC `.r10`

Found **53 project roots** with Mechanical takeoff PDFs but no `.r10`; these are unusable for the current oracle-based eval. The newest examples are Telluride Lot 2R and Lot 1R, with takeoff activity through 2024. None of this dead-end lane had takeoff activity newer than 2024.

All 53 roots:

`Matt Garcia Design / Telluride 857 Butcher Creek`; `Matt Garcia Design / Telluride 877 Butcher Creek`; `Signum / Helmer Residence`; `Classic Constructors / Peach Creek Phase 3`; `Thoughtbarn / Ridgelea`; `Soloway / Jury Residence`; `Backen and Backen / Hixon House`; `GM Architects / Carlow Residence`; `Urban Order / 76 Guest House`; `Signum / Kavanaugh Residence`; `Feldman / Fog's Edge`; `Olson Kundig / Lopez Island Residence`; `Michael G Imber / Heritage Canyon Ranch`; `RHO / Mehdi-Lavery Residence`; `Webber Studio / 613 Blanco`; `Urban Order / Cliff House`; `Studio Rick Joy / Bouldin Residence`; `Feldman / 33 Potrero Trail`; `Tim Boyle / Stephan Residence`; `Yellow Bike`; `Prospect Studio / Taproot Farm`; `Feldman / Curveball Residence`; `Studio Rick Joy / Boundary Waters Cabin`; `Pollard Hodgson / Flahive Vacation House`; `Dan Hotek / Fleming Residence`; `Clayton Korte / Glencliff`; `Comeaux / Flatstone Bluff`; `Lake Flato / Bowlin Residence`; `AoverA / Menschel`; `Dovetail / Moritz Ranch`; `Alterstudio / 1501 Rabb`; `Ryan Street / Tynberg Residence`; `Janson Luter / Martin Residence`; `Firm 151 / Angel Point Central Plant`; `Studio Luck / Shimmering Cove`; `Farmer Payne / Roberts Lodge`; `Hoedemaker Pfeiffer / Leelanau Wine and Car Barn`; `Sanders / Smith Lake House`; `Lemmo / Bicentennial House`; `Jennifer Bolyn / Klish Way Residence`; `Kiel Moe Residence`; `Hoedemaker Pfeiffer / Hunts Point Residence`; `U+R Design Collaborative`; `Larue / Stay Bungalow`; `Mell Lawrence / Martin House`; `Duke C. Garwood / Keller Ranch House`; `Lake Flato / Palmer Residence SLC`; `Olson Kundig / Muirlands Drive Remodel`; `Mell Lawrence / Sugar Creek`; `Playa / Yalamanchili Residence`; `Mell Lawrence / Minka House`; `Garwood / Myers Residence`; `Lake Flato / La Sierrita`.

## Limits and next proof

- All Drive work was metadata/read-only plus direct reads of selected `.r10` and PDF files. Nothing was written to G:.
- The top three `.r10` files were queried through the 32-bit Jet read-only lane for room/system counts and approximate `Length x Width` area. RHVAC itself was not opened or recalculated.
- Revit filenames, sizes, and paths were inspected, but no model was opened. Native architectural/link filenames are strong Rooms/Walls evidence, not proof. The next safe step is to copy project-b and Deer Path locally and inspect them in a FreshRevitProcess, without touching the user-owned RRD session.
- PDF measurement counts prove genuine takeoff annotations, not one-to-one alignment with RHVAC. project-b' 23 areas versus 22 rooms and Deer Path's 26 versus 26 make them the best first alignment checks.
