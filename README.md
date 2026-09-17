# Rust Web Frontier

A browser-native, first-person multiplayer survival game with a western frontier setting and a Rust Legacy-inspired survival loop. The authoritative game server runs on Diego's computer while it is on.

**Current status: design only. No playable game or server is implemented.** “Rust” in the repository name refers to the game inspiration; the proposed implementation uses TypeScript, not the Rust programming language.

## Design documents

- [Complete game design document](docs/GDD.md) — vision, Legacy fidelity, gameplay, world, presentation and scope.
- [Content and balance](docs/CONTENT.md) — item catalog, recipes, gathering, weapons, armor, buildings and loot.
- [Technical design and home hosting](docs/TECHNICAL.md) — browser architecture, authoritative multiplayer, saves, security and operations.
- [Production and acceptance](docs/PRODUCTION.md) — milestones, dependencies, estimates, risks and release gates.
- [Sources and decisions](docs/SOURCES_AND_DECISIONS.md) — historical evidence, relationship to the Unity project and explicit adaptations.
- [Design validation](docs/VALIDATION.md) — document checks and remaining empirical questions.

The documents form one GDD package, version 1.0, dated September 16, 2026. Gameplay rules live in GDD; numerical catalogs live in CONTENT; networking and persistence contracts live in TECHNICAL. A contradiction is a defect to resolve, not permission to choose silently.

The matching Obsidian folder is `C:\Users\diego\Documents\diego_vaults\Personal\Rust Web Frontier`. Its document copies use the same relative layout. The repository becomes the canonical editable copy after this initial delivery; synchronize revisions to the vault together.

## First implementation milestone

Start with M0 in [PRODUCTION](docs/PRODUCTION.md): prove two remote browser clients can move, gather, exchange an item, disconnect into a sleeper, and reconnect to one persistent authoritative home server. Do this before building the full world or producing final art.
