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
| D26 | Depend on `@colyseus/core` + `@colyseus/ws-transport` directly, not the `colyseus` umbrella package | Proposed; the umbrella package additionally pulls in unused `@colyseus/auth`/Redis sub-packages. `npm audit` still reports 8 low/moderate advisories because `@colyseus/core` 0.18.14 itself hard-depends on `@colyseus/auth` (OAuth `grant`/`jwk-to-pem`/`elliptic`, and `request-oauth`'s `uuid`), none of which this project's own invite-code/recovery-secret auth (TECHNICAL §5) exercises. `npm audit fix` offers no non-breaking resolution. Accepted as a known risk for the private M0 prototype; re-check before any public exposure per TECHNICAL §10 |

Subsequent changes must record the affected decision IDs, player-visible consequence, evidence and modified acceptance cases. Replacing a default with a new rule is allowed; contradictory rules in separate files are not.

### 2026-09-17 — Full-project code review

Ran a whole-tree review (not a diff) across `apps/server`, `apps/client`, `packages/*` and `tests/`. Nineteen findings were filed and twelve fixed, each test-first. The reachable-in-normal-play defects were: an unwrapped camera yaw that exceeded `MoveIntentSchema`'s `[-PI, PI]` bound after roughly half a turn, which Colyseus answers by disconnecting the client rather than dropping the message; a move intent that was latched forever, so one packet drove the avatar indefinitely; and two callsites that spent world state (a node's budget, a craft's escrow) and then discarded `addToInventory`'s overflow, destroying the item. The security findings were an absent server-side reach check (reach was enforced only in the client, leaving `out_of_range` dead code), absent rate limiting of any kind, and a server that trusts a client-supplied `accountId`.

Three findings are deliberately not fixed and remain open, recorded as decisions below.

| ID | Decision | Status and reason |
|---|---|---|
| D27 | The transport-level message cap (`maxMessagesPerSecond = 60`, which disconnects) is deliberately distinct from TECHNICAL §10's documented "total client action ceiling 40/s" | Proposed. The two are different mechanisms: Colyseus's cap is a blunt kill switch on total frames, set at 3x honest traffic (the client sends 20 move commands/s) so no legitimate player is ever dropped, whereas the documented 40/s ceiling is a *validation* rule that should reject with `rate_limited` and keep the session alive. Only the per-action swing cooldown (CONTENT §4's 1s interval) is implemented so far; the general 40/s action ceiling is not yet, and is not satisfied by the transport cap |
| D28 | The server continues to trust the `accountId` supplied in a client's join options | Known defect, not accepted as a design. Anyone who learns another player's `accountId` can join as them, load their inventory, control their body, and — because `beginSession` increments the epoch on every join — permanently invalidate the real owner's session. TECHNICAL §5 already specifies the replacement (host-created invite codes, a server-generated recovery secret stored only as a hash, HTTPS with a short-lived session plus an HttpOnly refresh cookie), which is a milestone-sized feature rather than a patch. Until it lands, the server must not be exposed beyond a trusted private test |
| D29 | Crafting continues to advance for disconnected accounts | Open question, not a defect. The vitals loop deliberately skips sleepers per GDD §12, and `tickCrafting` deliberately does not, but nothing in GDD §9 states which rule crafting follows. Offline crafting is defensible; the point is that the two neighbouring conventions currently disagree without the design saying so. Needs a GDD §9/§12 ruling before it is treated as either correct or broken |

Also recorded: `movementByAccount`, `playerVitals` and `state.players` are never pruned on leave, so checkpoint cost and replicated state grow with the all-time player count rather than the concurrent one — deliberate today (a disconnect leaves a sleeper, GDD §12) but it needs a real sleeper-eviction rule before a public test. The `transactions` table is likewise never pruned; it is now bounded by the message cap rather than unbounded, but still grows without limit over a world's lifetime.

### 2026-09-17 — Pickup actually picks up; interaction feedback and camera smoothing

Two player reports: the brown box on the ground could not be picked up, and the game ran slowly.

The pickup defect was real and total. `resolveTakeItem` claimed the item on the replicated state and stopped there — it never touched `playerSlots` — and `handleCommand` never followed a take with an `inventory` message. So a successful take removed the item from the world and gave the player nothing: the item was destroyed, not collected. The grant now runs inside the same `commitOutcome` factory as the claim (so a replayed sequence still cannot double-grant), and, as `resolveHitNode` already did for gathering, capacity is checked *before* the claim: a full pack refuses with `insufficient_resources` and leaves the item where it is, rather than claiming it and finding nowhere to put it.

The client also made every refusal invisible. `attemptTakeItem`/`attemptHitNode` each re-implemented GDD §5's 2.5m reach and returned silently when out of range, so an out-of-reach press was indistinguishable from a dead keybind — nothing happened and nothing said why. Both prechecks are gone: the server is the only authority on reach (a modified client would omit the check anyway), and its `out_of_range`/`already_taken`/`ok` now reaches the HUD. The HUD additionally names the nearest interactable, its distance and its key, because the two placeholder boxes are both brown and nothing distinguished the one E takes from the one the mouse gathers.

No frame rate was measured, so none is claimed. The HUD now reports `engine.getFps()` beside the fixed 20 Hz simulation rate, and the WebGL renderer string is logged once at startup, since a Chrome fallback to SwiftShader would cap the frame rate regardless of scene content. One genuine defect was found by inspection and fixed: the camera snapped to each 20 Hz state patch, so all motion stepped at 20 Hz however fast the renderer ran, and remote players used a constant blend factor of 0.5 that parked them permanently at the midpoint of their last two positions and never animated between patches. Both now blend on elapsed time. Camera *position* only — yaw and pitch stay local mouse input applied at full rate, since routing them through replicated state would make looking around lag by a patch.

| ID | Decision | Status and reason |
|---|---|---|
| D30 | Interaction reach is enforced on the server only; the client no longer pre-checks it | Proposed, replacing the duplicated check. The server's check is the one that counts, and the duplicate client copy could only ever suppress the server's answer — which is what made a refused interaction silent. The cost is one doomed packet per keypress, against a 60/s transport cap and 20/s of honest move traffic (D27) |
| D31 | The test harness holds Colyseus messages that arrive before any handler is bound, and replays them to a listener that binds later | Proposed; see `tests/setup.ts`. The SDK drops a message whose type has no handler, and `WorldRoom.onJoin` defers its join batch by one clock tick precisely so a test can bind handlers after `connectTo`. A full run puts ~20 Colyseus servers on one machine, and when the event loop stalls past that tick the join frames are delivered to nobody: a random file then failed on roughly one run in five. Raising the timeout does not help — verified at 15s — because the message is early, not late. `waitForMessage` is deliberately *not* fed from that buffer, since it means "the next frame after now" and tests depend on that; `session`, sent exactly once per join, is the single exception. `tests/integration/testing-harness.test.ts` reproduces the stall deterministically and fails without the fix |

### 2026-09-17 — Furnaces and campfires (T09)

T09 is met: 24 metal_ore and 12 wood loaded into a furnace produce 48 metal and 12 charcoal in 60 seconds with its inputs and fuel empty, and a full-output station consumes no inputs or fuel. The acceptance case is driven through real commands (`tests/integration/world-room.station.test.ts`), not by calling the simulation directly, so it covers routing, reach, capacity and persistence as well as the arithmetic. CONTENT §3's campfire check — 6 raw_meat and 6 wood into 6 cooked_meat and 6 charcoal — falls out of the same model with only a different spec, which is the evidence that the spec table generalizes rather than being fitted to one example.

Two consequences a reader of CONTENT should know about. **A station is public**: reach is the only gate, so anyone who walks up to a furnace can empty it, because GDD §11's ownership and permissions are M2 scope. **Cooked food never burns**: CONTENT §3's 60-second overcook rule, and its merge-retains-the-older-timestamp anti-juggling clause, need a per-stack age the slot model does not carry. Both are noted at their callsites.

| ID | Decision | Status and reason |
|---|---|---|
| D32 | `stepConversion` is replaced by `stepStation`, which steps a whole station rather than one queue | Required correction. CONTENT §3 makes a fuel quantum atomic across the station: "reserves output capacity for food/metal/sulfur and charcoal before each fuel quantum. At a fully blocked output, pause the entire station and do not consume fuel." Two independent per-slot conversions cannot express that — the fuel cycle would burn through the wood while a blocked ore slot stalled, which is the waste the rule exists to prevent. The old function was dormant: nothing outside its own test ever called it, and its six assertions are carried over |
| D33 | A station insert names an item, not a destination slot, and inputs spread evenly across the input slots | Proposed. Unambiguous because no station in this baseline accepts wood as an input, so wood can only mean fuel; the spread matters because each input slot converts one unit per quantum, so 24 ore in one furnace slot smelts at half the rate of 12 in each — which is why CONTENT's worked example says "12 metal_ore in each input". A real per-slot station panel arrives with M2's containers |
| D34 | Station contents replicate to players within reach, on arrival and on change | Proposed. Container contents stay off the shared schema per TECHNICAL §3, so they are pushed to the players who could open the station. On arrival specifically, because a cold empty station never changes and would otherwise be invisible to someone standing at it, and because a timer would cost bandwidth for every idle station |
| D35 | `rock_1` is a single-resource metal_ore node, not CONTENT §4's mixed rock | Known divergence. The real mixed rock carries three simultaneous budgets (stone 100, metal_ore 60, sulfur_ore 40) and pays all three per swing; `harvest.ts` models one resource per node. This seeds the metal_ore column only (budget 60, yield 3) so that a furnace has ore to smelt — without any ore in the world, T09 was reachable in tests and not in play. Replace when the node model carries multiple budgets |

Recorded against **D27**: the station commands are the third instance of an action that performs synchronous SQLite writes with no per-action cooldown (`stationInsert` and `stationTake` each write the player's slots *and* the station, and the station write deletes and re-inserts every occupied slot). At the 60/s transport cap that is a heavier game-loop stall than the `hitNode` case the swing cooldown was added for. Three instances argue for implementing TECHNICAL §10's general 40/s action ceiling rather than adding a fourth per-action cooldown. Not urgent while D28 holds the host to a trusted private test.

### 2026-09-17 — Wildlife, bleeding and medicine (T08; T20 in part)

Wildlife was the keystone the rest of M1 was waiting on. Without animals there was no meat, so the campfire built earlier that day had nothing to cook; no bite, so GDD §6's bleeding had no source and T08 could not be exercised; and no carcass, so `harvestCarcassHit` stayed dormant. All three are now reachable in play.

**T08 is met.** A bandage is a 2-second channel that consumes nothing until it completes, cancels on incoming damage, sprint or disconnect without spending anything, and on completion consumes exactly one and clears the wound, followed by GDD §6's shared 2-second cooldown. The "no additive bleed exploit" half is `applyBleedWound`'s max-rate/latest-expiry rule, asserted against two bites in a row.

**T20 is met in part.** Animals detect, chase, attack and die, and a carcass pays its pool out over four hits exactly once however many players take turns at it — the "finite harvest paid once" clause. The rest of the gate cannot be exercised yet: "lose path" and "no wall attacks/teleports" need geometry to path around and walls to be blocked by, which arrive with M2, and "wildlife budgets maintained" needs the respawn director below. The world is a flat plane with no collision, so an animal today walks in a straight line at its target.

| ID | Decision | Status and reason |
|---|---|---|
| D36 | GDD §6's "damage... cancels" a use channel means *incoming* damage only | Required reading, not a preference. Bleeding ticks damage every tick, so a literal reading would have a wound cancel the bandage treating it before it could ever complete — making bleeding untreatable and contradicting the exact sequence T08 asks for ("bleed, cancel bandage by damage, then complete use"). Bites cancel; bleed, starvation, exposure and cold do not. Covered by its own test |
| D37 | Melee damage is CONTENT §5's rock (10) for everyone | Proposed, and the same gap the gather rate already has: CONTENT gives per-tool damage (rock 10, stone hatchet 15, iron hatchet 25, pickaxe 20) but which tool a player is swinging needs an equip/belt system that does not exist. Everyone swings the rock from their spawn kit until it does |
| D38 | A hurt animal stays alarmed for 5 seconds | Proposed; this is the project's number, not CONTENT's. GDD §7 says prey "flee when approached or hurt" and that "damage alerts the victim independently of detection" but gives no duration. Revisit with playtesting |
| D39 | Animals do not respawn, and are not persisted across a restart | Known gap. CONTENT §4's rule — at least 15 minutes dead and no player within 30 m of the anchor, inside a full-map budget of 24 living animals of which at most four are ash variants — needs a spawn director that tracks anchors and player proximity. Until then a hunted-out world stays empty until the host restarts, and a restart repopulates from the seed table rather than restoring where each animal stood. This is the "wildlife budgets maintained" half of T20 |
| D40 | Wandering is standing at the anchor | Proposed. A real idle walk needs a random source, which would make the room's simulation non-deterministic on replay; the tick-driven design otherwise has none. Add it as a seeded stream when animals need to look alive rather than merely behave correctly |

The spawn kit (GDD §5's rock, torch and two bandages) is granted on session epoch 1 — an account's first join ever — because that is the only available signal that separates a new player from one who has emptied their pack. Respawn-on-death will need its own rule when death exists in M2.
