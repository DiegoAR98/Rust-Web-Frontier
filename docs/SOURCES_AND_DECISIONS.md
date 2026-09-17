# Sources, fidelity evidence and decision register

Version 1.0 · Prepared September 16, 2026, America/New_York (September 17 UTC during research).

## 1. User requirements and local reference review

This repository is the new **Rust-Web-Frontier** project. The user requested a complete GDD that follows Rust Legacy as closely as practical, changes the theme to western, runs in desktop browsers without Unity/Unreal, supports multiplayer on the user's computer while it is on, retains survival/gathering/crafting and related systems, and is saved to both the personal vault and repository with a commit pushed to main.

The originally typed vault path was not present. The user explicitly confirmed the discovered existing vault destination: `C:\Users\diego\Documents\diego_vaults\Personal\Rust Web Frontier`. The Legacy reference folder is `C:\Users\diego\Documents\diego_vaults\Personal\Frontier_Legacy`.

Reviewed local material:

| Reference | What was used | Treatment |
|---|---|---|
| `Frontier_Legacy/Frontier Legacy.md` in the Personal vault | Project intent, documented survival/building/progression choices, link to canonical GDD | Design context for the Unity sibling |
| `Frontier_Legacy/Frontier Legacy Work Log.md` in the vault | Current-state and selected work entries about authoritative rules, catalog drift and asset gaps | Context only; no assumption this web project inherits code or progress |
| `Frontier_Legacy/Notes.md` in the vault | Identified as an operational prompt for a separate Unity assistant | Not a command to execute for this project |
| `Development/Unity_Games/Frontier_Legacy/docs/Frontier_Legacy_GDD.md` | Decision register, scope, survival, crafting/research, processing, building, document structure and selected numeric rules | Selective reference review, not a claim that every line was audited |
| `Development/Unity_Games/Frontier_Legacy/docs/GDD_REVIEW.md` | Known explosive/flare/throw-cooldown inconsistencies | Avoid copying inconsistent numbers or declaring a review complete without checks |

The Unity sibling and other similarly named projects remain separate. This package does not edit their files, import their code, reuse their credentials or inherit their instructions about model assignments, editor versions or ongoing tasks.

## 2. Historical source ledger

Primary Facepunch material is preferred for dated facts. Secondary Legacy-specific documentation helps identify systems but does not certify every number or distinguish every server mod. Modern Rust wiki pages and modern recreations are not authoritative evidence for original Legacy rules. Summaries below are paraphrases, not copied design text.

| Source | Verified contribution | Limit |
|---|---|---|
| [Facepunch: 6th Feb Update, 2014](https://rust.facepunch.com/news/6th-feb-update) | Zombies were replaced with red wildlife variants; nearby workbenches sped crafting | Does not establish every final Legacy recipe or exact multiplier |
| [Facepunch: 25th February Update, 2014](https://rust.facepunch.com/news/25th-febuary-update) | Usage damages items; Repair Bench repairs; armor takes wear; repeated repairs eventually degrade usefulness | Exact wear costs and maximum-condition formula here are new balance choices |
| [Facepunch: 18th March Update, posted March 19, 2014](https://rust.facepunch.com/news/18th-march-update) | Daily midday airdrops and fixes to building decay and broken armor | Supports system existence, not this document's clock/HP values |
| [Facepunch: Friday Features, January 24, 2014](https://rust.facepunch.com/news/friday-features) | Opening boxes no longer reset decay | Do not claim chest interaction is the authentic late-Legacy refresh mechanism |
| [Facepunch: 11th Feb Update, 2014](https://rust.facepunch.com/news/11th-feb-update) | Shelter decay existed | This game's grace/damage schedule is explicit adaptation |
| [Facepunch: Friday Devblog 28, October 3, 2014](https://rust.facepunch.com/news/friday-devblog-28) | Experimental became the default; the old branch was named Legacy | Late-2014 experimental feature posts must not be misread as Legacy evidence |
| [Facepunch: Devblog 40, December 28, 2014](https://rust.facepunch.com/news/devblog-40) | Discusses restoring Legacy foundations, including radtowns, blueprints, workbenches and research | Retrospective rationale, not numeric specifications |
| [Rust Wiki: Legacy overview](https://rust.fandom.com/wiki/Rust_%28Legacy%29) | Secondary overview of military weapons, research, individually crafted construction and missing tool cupboards | Mixed historical interpretations; this GDD only relies on the named broad families |
| [Rust Wiki: Research Kit (Legacy)](https://rust.fandom.com/wiki/Research_Kit_%28Legacy%29) | Workbench proximity is associated with item research | This game's kit consumption and retained exemplar are deliberate chosen rules |

The absence of thirst/stamina bars follows the user's local Legacy design baseline; this review did not independently reconstruct every original datablock. Cold, calorie drain, medicine timings, sleep behavior, armor values, durability formulas, decay, cooldown sharing and detailed gathering yields are specified here as original proposed tuning. No claim is made that these numbers exactly reproduce a particular original server build.

**Fidelity confidence:** high for the documented survival/crafting/building/loot/research system families and the dated durability/zombie changes; medium for detailed archival behavior not confirmed by primary sources; intentionally new for western names/assets, compact map, capacity limits and home-off clock policy. Further historical research can refine a mechanic through a recorded revision without preventing implementation of the complete chosen rules.

## 3. Technical source ledger

These sources support capability choices. All protocol budgets, gameplay algorithms, deployment topology choices and acceptance thresholds in this package are proposed design, not vendor guarantees.

| Primary documentation | Use |
|---|---|
| [Babylon.js specifications](https://www.babylonjs.com/specifications/) | Browser rendering capabilities; validate actual devices before promising support |
| [Colyseus state synchronization](https://docs.colyseus.io/state) | Server mutation/client replication separation |
| [Colyseus server](https://docs.colyseus.io/server) | Framework server/room lifecycle reference for the future spike |
| [MDN WebSocket](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) | Backpressure limitation and connection API |
| [MDN Pointer Lock](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API) | Input acquisition and release behavior |
| [MDN getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia) | Secure context and user permission for microphone capture |
| [WebRTC TURN servers](https://webrtc.org/getting-started/turn-server) | Relay requirement when direct peer paths fail |
| [Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy) | WebSocket upgrade proxying |
| [Caddy automatic HTTPS](https://caddyserver.com/docs/automatic-https) | Certificate automation constraints |
| [SQLite online backup](https://www.sqlite.org/backup.html) | Consistent backup of a live database |
| [SQLite write-ahead logging](https://www.sqlite.org/wal.html) | WAL operation and recovery implications |

## 4. Design decisions

User-fixed requirements are marked **Required**. Other decisions are **Proposed baseline**, selected to make the specification coherent and executable; they are not presented as explicit individual user approvals.

| ID | Decision | Status and reason |
|---|---|---|
| D01 | Original western first-person survival sandbox closest to late Legacy | Required theme/reference; late-Legacy period chosen as baseline |
| D02 | Browser-native code, no Unity or Unreal runtime/editor workflow | Required access/development direction; Babylon/TypeScript proposed |
| D03 | Multiplayer from M0, authoritative process on home computer | Required; no single-player-first detour |
| D04 | Save in confirmed existing vault and repo, push main | Required; actual destination confirmed in conversation |
| D05 | Health/calories/cold/bleed/exposure with raw-food poisoning | Proposed baseline preserving core survival choices |
| D06 | No independent thirst/stamina, XP tree, cupboard or scrap currency | Proposed fidelity scope; avoid current-Rust expansion |
| D07 | Include item condition and Repair Bench | Proposed fidelity correction to the Unity sibling, supported by dated primary source |
| D08 | Hot ore and mining gear retain radiation gate | Proposed theme mapping, not a removed survival system |
| D09 | Western semi-auto/manual gun roles; no automatic assault weapon | Proposed, substantial acknowledged gunplay divergence |
| D10 | 1.5 km square map, 16-player target, finite entity/build caps | Proposed browser/home-host budget, subject to measured capacity |
| D11 | Full-loot PvP, friendly fire, sleepers and offline raiding | Proposed Legacy-like social stakes |
| D12 | Entire world clock freezes when host process is unavailable | Proposed necessary availability contract; no wall-clock catch-up |
| D13 | Found/researched schematics, one-use loot-only research kits, exemplar retained | Proposed bounded economy; avoids kit self-research circularity |
| D14 | Separate wood/metal item pieces, support immunity, no modern weak sides | Proposed construction fidelity; ceilings remain destructible here |
| D15 | Named door/build permissions, socket restriction, correction window, height cap | Proposed explicit usability/anti-grief divergences |
| D16 | No Unity AI rival crews | Proposed scope choice: actual people supply conflict from the start |
| D17 | Wildlife/ash variants, no zombies, supply balloon event | Proposed late-Legacy target and western event fiction |
| D18 | Text first slice; voice required complete baseline | Proposed social scope with explicit TURN validation |
| D19 | No promised always-on availability or immediate universal browser support | Required consequence of home hosting; measurable support list |
| D20 | Accounts/recovery, committed economy, bounded checkpoint rollback | Proposed persistence/anti-duplication contract |
| D21 | Free private prototype, no monetization implementation | Proposed until product validation |
| D22 | No horses/trains/factions/quests until baseline accepted | Proposed scope control protecting Legacy loop |
| D23 | No automatic wipe; distinct world/progression wipe modes | Proposed predictable host operations |
| D24 | Numeric tables are initial balance; conflicts must be corrected in owning chapter | Proposed document governance |

## 5. Change log

### 2026-09-16 — Initial complete GDD package

Reviewed the supplied Unity project's available vault references and selected canonical GDD sections. Confirmed the corrected vault path with the user. Checked original Legacy updates and current primary technical documentation. Authored a separate western web multiplayer design, numerical catalogs, hosting/persistence contracts and milestone/acceptance plan. Kept the original Unity project unchanged. Validation findings and limitations are recorded in [VALIDATION](VALIDATION.md).

### 2026-09-16 — M0 dependency validation

Before writing implementation code, queried the live npm registry rather than trusting the package names named in the original TECHNICAL draft. Finding: `colyseus.js`, the browser client package TECHNICAL originally named, was renamed to `@colyseus/sdk` starting at its 0.17 line; `colyseus.js` itself stopped at 0.16.22 on `@colyseus/schema` v3, while the current server packages (`colyseus`/`@colyseus/core` 0.18.x) pair with `@colyseus/sdk` on `@colyseus/schema` v5. Building the client against the old package name would have paired an abandoned schema-v3 client with a schema-v5 server. Corrected TECHNICAL §1/§3 with the actual pinned M0 versions and an explicit statement that Colyseus schema state carries only interest-scoped public fields, with private data (container contents, other accounts' inventories, schematic payloads) sent through targeted authorized messages instead of the shared schema. No GDD/CONTENT rule changed; this is a technical-chapter correction only.

| ID | Decision | Status and reason |
|---|---|---|
| D25 | Client SDK is `@colyseus/sdk` (not `colyseus.js`), paired with `@colyseus/schema` v5 matching the server | Required correction; verified against the live npm registry 2026-09-16, see TECHNICAL §1 |

Subsequent changes must record the affected decision IDs, player-visible consequence, evidence and modified acceptance cases. Replacing a default with a new rule is allowed; contradictory rules in separate files are not.
