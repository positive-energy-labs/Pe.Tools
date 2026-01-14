# Project Dependencies Diagram

```mermaid
graph TD
    %% Base layer - no dependencies
    PeGlobal["Pe.Global<br/>(Base Library)"]
    
    %% Second layer - depends on Global
    PeExtensions["Pe.Extensions"]
    PeLibrary["Pe.Library"]
    
    %% Third layer - depends on Global and/or Library
    PeUi["Pe.Ui"]
    
    %% Fourth layer - depends on multiple projects
    PeFamilyFoundry["Pe.FamilyFoundry"]
    
    %% Top layer - main application
    PeApp["Pe.App<br/>(Main Application)"]
    
    %% Standalone projects
    Build["Build.csproj<br/>(Build Tool)"]
    Installer["Installer.csproj<br/>(Installer)"]
    
    %% Dependencies
    PeExtensions --> PeGlobal
    PeLibrary --> PeGlobal
    PeUi --> PeGlobal
    PeUi --> PeLibrary
    PeFamilyFoundry --> PeExtensions
    PeFamilyFoundry --> PeGlobal
    PeFamilyFoundry --> PeLibrary
    PeFamilyFoundry --> PeUi
    PeApp --> PeExtensions
    PeApp --> PeFamilyFoundry
    PeApp --> PeGlobal
    PeApp --> PeLibrary
    PeApp --> PeUi
    
    %% Styling
    classDef baseLayer fill:#e1f5ff,stroke:#01579b,stroke-width:2px
    classDef secondLayer fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef thirdLayer fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef fourthLayer fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    classDef topLayer fill:#fff9c4,stroke:#f57f17,stroke-width:3px
    classDef standalone fill:#f5f5f5,stroke:#616161,stroke-width:2px,stroke-dasharray: 5 5
    
    class PeGlobal baseLayer
    class PeExtensions,PeLibrary secondLayer
    class PeUi thirdLayer
    class PeFamilyFoundry fourthLayer
    class PeApp topLayer
    class Build,Installer standalone
```

## Dependency Summary

### Base Layer (No Dependencies)

- **Pe.Global** - Foundation library with no project dependencies

### Second Layer (Depends on Global)

- **Pe.Extensions** → Pe.Global
- **Pe.Library** → Pe.Global

### Third Layer (Depends on Global/Library)

- **Pe.Ui** → Pe.Global, Pe.Library

### Fourth Layer (Depends on Multiple Projects)

- **Pe.FamilyFoundry** → Pe.Extensions, Pe.Global, Pe.Library, Pe.Ui

### Top Layer (Main Application)

- **Pe.App** → Pe.Extensions, Pe.FamilyFoundry, Pe.Global, Pe.Library, Pe.Ui

### Standalone Projects

- **Build.csproj** - Build automation tool (no project references)
- **Installer.csproj** - Installer generator (no project references)
