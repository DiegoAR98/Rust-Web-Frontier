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

### 2026-09-17 — Closing the survival loop: food, poisoning and regeneration

Putting wolves in the world made an unrecoverable state reachable in about ten seconds, which is worth stating plainly because it was a consequence of the previous change rather than a pre-existing gap. Health was monotonically non-increasing: starvation, exposure, cold, bleeding and bites all subtracted, and nothing anywhere added. Seven bites put a player at 0 HP permanently, and GDD §6's "health at zero triggers one death transaction" is M2 scope. The same asymmetry applied to calories — a player could hunt a deer, cook the meat on the campfire built the same day, and have no way to eat it.

Both halves of GDD §6 that answer this are now wired, and both reuse machinery that already existed. Food is a use channel, so it inherits the bandage's cancel-consumes-nothing and consume-on-completion path unchanged. Passive regeneration is a pure function of the conditions GDD lists, called from the survival tick.

| ID | Decision | Status and reason |
|---|---|---|
| D41 | 0 HP remains a terminal state with no recovery, and is a known invalid state until M2 | Accepted limitation, now much harder to reach. GDD §6 says health at zero triggers one death transaction; death, corpses, bedroll respawn and loot-on-death are M2's gate (T13). Until that exists a player at 0 HP stays there, alive and unable to act on it. Regeneration, food and bandages mean reaching it now takes sustained neglect or a losing fight rather than one unlucky encounter |
| D42 | Only cooked meat and raw meat have consumable effects | Proposed. CONTENT §1 also gives beans (+300 calories, −25 exposure) and rations (+600, +10 health, −50 exposure), but CONTENT §12 makes both loot-only and there is no loot table yet, so rows for them would be data nobody could reach. Added with the loot system |
| D43 | Food poisoning reuses the bleed wound structure and its tick | Proposed. GDD §6 gives poisoning a rate and a duration that "refreshes, not stacks" — the same max-rate/latest-expiry rule `applyBleedWound` already implements for bleeding, and the same per-second damage `tickBleed` already applies. Modeling it separately would have duplicated both. They stay distinct maps because regeneration checks them separately and a bandage clears only one |

Two consequences of wiring regeneration are worth noting. A lit campfire now has a second reason to exist besides cooking — GDD §6's 0.4 HP/s — which is also the hook the cold vertical's warmth will use (T07's unfinished half). And `MELEE_SWING_CALORIE_COST`, which had a constant and no callsite since the gather vertical, is now charged on every accepted swing; a refused swing is still free.

Bleeding and poisoning are now checkpointed with the vitals they drain. They were in memory only, so stopping the host cleared them while the damaged health stayed — a free heal of the same shape this codebase already refuses for station fuel, and contrary to GDD §12's rule that a sleeper's "existing bleeding, poison and exposure finish under normal rules".

### 2026-09-17 — A fire that warms as well as heals (T07's fire case)

Wiring regeneration to a lit campfire introduced a contradiction with the cold vertical that shipped earlier: `isNearLitCampfire` granted the 0.4 HP/s campfire rate, while `currentColdDeficit` still hardcoded warmth to 0, so at night the same fire both qualified a player for regeneration and — through `coldBlocksRegeneration` — zeroed it. Neither behaviour was individually wrong; together they meant standing at a fire did nothing.

The cold deficit is now computed per player rather than for the world, using GDD §6's "a fire within 4 m with unobstructed warmth ray gives 40". **T07's fire case is met**: a player at a lit campfire has no cold penalty on a lowland night and regenerates at the campfire rate. The cloth half of T07 is still open — warmth from worn equipment needs the equip system D37 is also waiting on, and until then `FIRE_WARMTH` is the only warmth source in the world.

Recorded against **D43's closing note**: the hook that entry predicted the cold vertical would use is now the one it uses. No decision changed; the code caught up with the design.

### 2026-09-17 — M2 opens: death, corpses and respawn (T04 in part; T13 in part)

**D41 is closed.** Zero HP was a terminal state a player could reach and never leave, which the previous entry recorded as a known invalid state. GDD §11's "zero HP is death" and §12's death transaction are now implemented, so every damage source in the game — bites, starvation, exposure, cold and bleeding — leads somewhere.

Death is checked wherever health can fall rather than swept up at the end of the tick, so a dying player stops being a live target inside the step that killed them: a wolf cannot land a second bite on a body that is already a corpse. A dead account has no transform to checkpoint, nothing for wildlife to home in on, and no accepted command but `respawn`.

**T04 gains its death case.** A corpse and the dead flag are written at the commit, not at the next five-second checkpoint, and the restart tests deliberately never call `checkpoint()`. A force-kill immediately after a death restores the corpse once, does not hand the pack back to the living body, and does not resurrect a corpse that had already been looted. `respawn` runs through `commitOutcome`, so a duplicated command replays the first outcome instead of granting a second starter kit.

**T13 is met in part.** "Full loot preserved" and "one sleeper/body identity" hold: everything a player carried, including the craft escrow, moves to one corpse, and reconnecting while dead resumes the same dead account rather than creating a fresh body. The bedroll half — "destroy bedroll, use nearby second anchor; destroyed anchor unavailable; shared cooldown enforced" — needs personal respawn anchors, which are a later vertical. There is also no player-versus-player damage source yet, so the only way to die today is to the world or to wildlife.

| ID | Decision | Status and reason |
|---|---|---|
| D44 | Respawn grants the starter kit again, every time | Required reading. GDD §12's "Respawn grants the starter kit exactly once" is an idempotency clause about one respawn, not a lifetime allowance: a player who respawned naked with no rock and no bandages would have no way to start over, and §5's kit exists precisely to make a fresh start possible. The "exactly once" is enforced by `commitOutcome`, which is what makes a replayed respawn command return the first outcome. Supersedes the note under D40 that respawn-on-death would need its own rule |
| D45 | Four authored respawn anchors stand in for the map's sixteen | Known divergence. GDD §12 names "a valid Coyote Wash or Juniper perimeter anchor" and §13 authors 16 arrival anchors; there is no map yet. The four are placed clear of the hot-ore zone at the origin and of the wolf, so a respawn is not immediately another death. `chooseRespawnAnchor` already implements the real rule — prefer 75 m from active enemies, otherwise the least exposed — so replacing the table is all the map needs to do |
| D46 | The craft escrow moves into the corpse rather than staying owed to the account | Required correction, not a preference. GDD §12 lists craft escrow among what death moves, and §8 requires that "overflow cannot be lost due to queued crafting". Once the live character is gone the corpse is the only place the escrow can be reached, so the queue is cancelled and its refund is added to the body. A returning player collecting escrow from a queue their corpse outlived would be a duplication |
| D47 | A dead account is refused every command, with no timer and no auto-respawn | Proposed. GDD §12 gives a dead player "a death recap and respawn options" and says nothing about a forced delay, so the body waits for the player. The new `dead` and `not_dead` reason codes make the state legible to a UI rather than silently dropping commands |
| D48 | The 40-slot corpse and its overflow manifest are implemented although overflow is currently unreachable | Deliberate. A 24-slot backpack plus the craft escrow cannot exceed 40 slots today, so nothing in play can fill the manifest. It is implemented as a pure function with its own rule tests because §12 names it, because belt, worn gear and loaded weapons are what make it reachable, and because the alternative — silently dropping what does not fit — is the failure the rule exists to prevent. The manifest is reported to clients as a count, not contents: §12 calls it noninteractive |
| D49 | An emptied corpse is removed immediately rather than waiting out its 30 minutes | Proposed. GDD §8's 30-minute death bag lifetime is about loot nobody has come back for; a body with nothing in it is a prop that invites a pointless interaction. A corpse that still holds anything keeps the full timer, which never refreshes on inspection |

Recorded against **D28**: death is the first command outcome that destroys a player's holdings, so a forged `accountId` is now worth more than it was. Nothing changed about the trust model — the host must still not be exposed beyond a trusted private test — but the cost of that gap has gone up.

Recorded against **D27**: `corpseTake` is the fourth action performing synchronous SQLite writes with no per-action cooldown. The general 40/s action ceiling remains unimplemented and remains the right fix.

### 2026-09-17 — Storage crates and the placement pipeline (T11 in part)

The first thing a player puts into the world themselves. GDD §10's pipeline at its simplest — an inventory item becomes a placed thing, and "a server-accepted placement consumes one item" — deliberately without the 4 m grid, snapping or support rules, which belong to building pieces and would have been fitted to a single example if they had arrived here.

**T11 is met in part.** "Accessible open-box loot allowed" holds: any player who can reach a crate can open it, which GDD §8 states outright ("Boxes are not magically private. Any person who reaches a box can open it; doors supply security"), and a test pins it so that the door-permission vertical cannot quietly change it. The rest of T11 — unauthorized door and socket operations, and through-wall loot denial — needs doors and walls to exist.

Placement is the sixth instance of capacity-before-consume. §10 requires that "reaching a cap produces an understandable error before consumption", and the same has to hold for every other refusal: an out-of-reach or overlapping placement leaves the crate in the pack. An insert moves only as much as the crate can hold, for the same reason.

| ID | Decision | Status and reason |
|---|---|---|
| D50 | Deployable spacing is §10's 1 m foundation clearance, reused | Proposed. §10 requires "minimum non-overlapping spacing" for deployables without giving a figure, and gives exactly one clearance number in the same paragraph — "at least 1 m from any existing foundation edge". Reusing it beats inventing a second number, and it is measured on the ground plane rather than in three dimensions because nothing stacks yet |
| D51 | Placement reach is the interact reach, and the ghost stands 2 m ahead at ground level | Proposed. §10 does not give a placement range. Using the same reach as every other interaction means a player who can open a station can place a crate beside it, which is the intuition the rest of the controls already teach. Pitch is ignored: a crate goes on the ground, so aiming it at the sky could only ever produce a refusal |
| D52 | `small_crate` is the only deployable | Proposed. CONTENT §7 also gives the large crate (Learn/Bench, no research system yet), bedrolls and cots (spawn anchors rather than containers, with their own cooldown rules), and the stash (buried, which is its whole point). Each arrives with the vertical that makes it reachable, rather than as unreachable table rows |
| D53 | A placed crate has health that nothing can damage yet | Known gap. CONTENT §7's 250 placed HP is stored and replicated because a crate without it could not be raided later without a migration, but no damage source reaches a deployable: §11's "destroying a box produces its loot" and §10's spill-once-on-removal need the combat and cascade work that T12 gates. Until then a crate is indestructible, which is not the design |
| D54 | The world entity cap counts deployables only | Accurate today, incomplete by design. §10's 6000-entity cap covers "build/deployable"; there are no build pieces, so the count is exact. It becomes wrong the moment structural pieces exist, and the building vertical has to widen it rather than add a second cap |

The client's ghost imports the server's own clearance constant rather than copying the number, so the preview and the answer cannot drift into two different rules. It stays a preview: the key sends regardless and the HUD reports what the server said, so a client that got it wrong can neither turn a refusal into a placement nor hide one that would have been allowed.

`moveAllThatFits` was extracted while writing this: `stationTake` and `corpseTake` had each written out the same "move what fits, leave the rest where it was" loop, and `containerTake` would have been the third copy. `placed_at_tick` is recorded although nothing reads it — §10's 120-second demolition window counts from placement, and a row that never stored when it was placed cannot acquire the fact later without a migration.

### 2026-09-17 — Buildings, doors and what a wall is for (T10; T11)

**T10 is met.** Six craft orders turn exactly 360 wood into CONTENT §7's piece list, and all ten snap into a legal 1×1 cabin through real commands. The ceiling is refused until the fourth pillar is under it — the gate's "no unsupported ceiling" as a test rather than a comment. The 360 is summed from the recipe table rather than asserted as a bare number, so a typo in any row fails instead of passing 360 === 360.

**T11 is met.** Unauthorised door operation and unauthorised socket attachment are both refused; through-wall loot is denied; loot through an empty doorway or an open door is allowed. That last clause matters: a rule that denied everything near a wall would pass the first half of the gate and fail what GDD §8 actually says, which is that "boxes are not magically private" and "doors supply security".

Reach was previously a distance check alone, which meant a raider standing outside a base could open a crate a metre inside it. Walls now block a reach, and a test proves a raider who walks round the end of a 4 m wall still gets in — the rule is geometry, not an ownership check wearing geometry's clothes.

| ID | Decision | Status and reason |
|---|---|---|
| D55 | A build intent names a grid site, not a position | Required correction, not a preference. §10 snaps every structural piece, so a float triple would have to be reverse-engineered back into a cell and rounding at a cell boundary would silently decide which one. The client names the site; `worldPositionOf` exists only for drawing and for the reach check |
| D56 | Building membership is derived from the structural links, never stored | Proposed, and load-bearing for later. A stored cluster id goes stale the first time a collapse splits a building in two, which §10's cascade removal makes routine. At 400 pieces per owner and 1000 per building the walk is free. It is rebuilt at load, and a restart test attaches a stranger to prove it — without the rebuild every base in the world silently opens, and the foundation still looks perfectly fine in the replicated state |
| D57 | Two adjacent foundations are one building, including diagonally | Proposed. Sharing an edge and sharing a corner are both 0 m apart, so both are attachments and both need the owner's permission. It also makes "not adjacent" and §10's "at least 1 m from any existing foundation edge" the same test, since one clear cell is 4 m. Deliberately *not* `PLACEMENT_CLEARANCE_M`: the crate's 1 m and this are different rules and must not share a constant |
| D58 | Build reach is 6 m, not the interact reach | Proposed. §10 gives no placement range. A 4 m cell's centre is 2.8 m from the corner a player stands on before eye height counts, so the 3.5 m interact reach could not place the foundation they are standing on. Six metres reaches the cell they occupy and the one next to it, and no further |
| D59 | A door belongs to the doorway's owner, not to whoever installed it | Required reading. §10 says "only the authorized builder can install a replacement door", which means a non-owner can install one; if the door then answered to the installer, an authorised builder would walk away holding the locks to a base that is not theirs |
| D60 | Door access is per door; build permission is per owner | Proposed. §10 grants door access "through a local interaction", which is something done standing at one door — and per-door lists are what Legacy's access rules were. Build permission cannot be keyed the same way: a building has no stable identity to name, because membership is walked from the links and changes every time a piece goes up. "X may build on anything I own" is the honest approximation |
| D61 | Occlusion is a ground-plane segment test | Proposed. Everything a player can currently reach for — crates, corpses, stations, doors — sits on the floor, so a 2D crossing test is exact for what exists. Doing it in three dimensions would mean inventing a wall's blocking volume, which CONTENT does not give. Revisit when ceilings have something above them worth reaching |
| D62 | Only the five wood forms the cabin needs are placeable | Proposed, the same shape as D52. CONTENT §7 gives nine forms in two tiers; windows, stairs, ramps and steps have no vertical yet, and the whole metal tier is Learn/Bench with no research system. The storey-above-needs-a-ceiling-below rule is implemented anyway because the grid needs it, but without stairs there is no way to *reach* storey 1 in play |
| D63 | A placed piece or door has health that nothing can damage | Known gap, and the same one as D53. CONTENT §7's HP and combat-immunity columns are stored and replicated, but no damage source reaches a structure. T12's satchel counts, §10's cascade removal and spill-once, the 60-second broken-socket lockout and the 120-second demolition window all wait on it. `placed_at_tick` is already recorded so the window can be added without a migration |

Two consequences worth stating. **The world entity cap now counts both** structural pieces and deployables, which is what D54 said it would have to do. And **a base is currently unraidable** — not by design but because nothing can damage a structure, so the only way through a locked door is to be given a key.

The client's ghost imports `validatePieceSite` rather than reimplementing the support rules, so the preview and the answer cannot become two different rules. It stays a preview: it does not know the per-owner caps or where other players are standing, so the HUD says "clear here" rather than "allowed".

### 2026-09-17 — Which reaches a wall stops (amends D61)

Making reach wall-aware caught every caller of one shared helper, including `hitNode`, `attackCreature` and `harvestCarcass`. That silently introduced a rule the design does not have, and it only showed up because the question was asked directly: nothing in the suite built a wall near a wolf.

| ID | Decision | Status and reason |
|---|---|---|
| D64 | Occlusion applies to reaching *for* things, not to swings | Proposed, and a correction to how D61 was first wired. Containers, corpses, stations, doors and world items go through the occluded check, because all five are the loot T11 denies through a wall. Swings — `hitNode`, `attackCreature`, `harvestCarcass` — stay on plain distance: GDD gives no rule against hitting what is on the far side of a wall, and T20's "no wall attacks" constrains animals rather than players, so denying it would be inventing a rule rather than implementing one. It also keeps a scan of every wall in the world off the 20 Hz swing path |

The barrier list is cached and invalidated when a piece goes up or a door swings, rather than rebuilt per reach check. Recorded against **D27**: rebuilding it per call was the same shape as the un-cooldowned work that entry already tracks, and it was reached far more often.

### 2026-09-17 — Raiding, rot and somewhere to come back to (T12 in part; T13)

Four verticals that only made sense together: a base that could not be damaged was unraidable by accident rather than by design, a base that never decayed was permanent litter under a 6000-entity cap, and a death with no personal anchor sent every player back to the map's edge.

**T13 is met.** "Full loot preserved" and "one sleeper/body identity" came with the death vertical; bedrolls close the rest. All four of GDD §12's anchor clauses are implemented with a test each: a new anchor starts on its full cooldown, using one puts every other anchor of the owner's within 50 m on *at least* the same cooldown, a destroyed anchor is refused by name rather than silently swapped for a random one, and cooldowns are written at the commit that starts them because §12 says they "use persisted simulation time".

**T12's maths and occlusion are met; its item is not.** CONTENT §8's 600 contact damage against the four barriers T12 names gives exactly the 1/2/2/4 the gate asks for, and that falls out of the table rather than being fitted to it. The satchel item and its crafting chain stay in M3, where PRODUCTION §1 puts "satchel raid" — so the blast is driven by a test-only detonation, and the gate's "minimum contact satchels" clause is proven while its economy is not yet reachable in play.

**Decay works, and so does the collapse.** §10's cascade runs on a real destruction, and the pure function that computes it is ordered so a support always falls before its dependents.

| ID | Decision | Status and reason |
|---|---|---|
| D65 | Structure health is class-2 and checkpointed; destruction is class-1 | Proposed. A raid is hundreds of hits, and writing each one would put an fsync on the game loop per swing — the D27 problem at its worst. T04 explicitly allows "continuous uncommitted state rollback ≤5 s", which is a few swings of damage. The removal itself is written at once, because a force-kill must not resurrect a wall that has already fallen |
| D66 | The raid lock is stored per piece and answered by walking the building | Proposed, and forced by D56: a building has no id, so "building-wide" has to be computed the same way ownership is. Owner damage starts it too, exactly as §11 says — otherwise a defender taps their own wall and keeps building through a breach |
| D67 | A broken or decayed container spills into a bag, which is a corpse with a shorter clock | Required by §8, which says drop containers "use the same 40-visible-slot plus paged overflow representation as corpses". Reusing the corpse entity outright means looting one already worked. Ten minutes rather than thirty, stored per bag so it keeps its own clock across a restart. An empty container leaves no bag, the same reasoning as D49 |
| D68 | Foundations and pillars decay even though they are combat immune | Required reading. CONTENT §7's own row says "Combat immune; decays", and §10's immunity is to *combat*. A base nobody could ever remove would be permanent litter under the same section's 6000-entity cap |
| D69 | Only an owner or their explicit builder refreshes a decay clock | Proposed. §10 names "awake connected owners or authorized builders within 50 m"; a stranger standing in someone else's base propping it up indefinitely is the opposite of what the rule is for. A sleeper is disconnected and so is already absent |
| D70 | The decay activity stamp is persisted | Required correction found while writing it. Held in memory only, every restart reset the clock, so a host restarted nightly would never let anything rot — and §10's whole decay rule would have been unreachable in practice while passing all of its tests |
| D71 | Blast occlusion reuses the reach occlusion, on the ground plane | Proposed, and the same limitation as D61. §11's "one intact structural barrier occludes further structural blast damage" is the same question `isReachBlocked` already answers. The blocking set is taken from the pre-explosion world, which §11 requires by name |
| D72 | A piece's material is read off its id prefix | Proposed. CONTENT §8 has two multipliers, wood and metal, and CONTENT §7 names all eighteen pieces and both doors with a tier prefix. A `material` column would be a second place for the same fact to be wrong |

**A live defect, found by reading CONTENT §8 for T12 and fixed with it:** melee damage to structures was applying the full tool damage, where §8 says "Tools deal their base melee damage ×0.5 to wood and ×0.05 to metal". A rock was a viable raiding tool, which left no reason for anyone to build an explosive at all. Four tests had encoded the wrong number and were corrected with the rule.

**Still open in M2.** Repair (§10's hold-interact-for-2-seconds and its `ceil(cost × restoredHP / maxHP × 0.5)` formula) and demolition (the 120-second window; `placed_at_tick` is already recorded so it needs no migration) are not implemented, and the raid lock that would block both is. §10's tier swap, the 60-second broken-socket lockout and the no-build polygons are also unimplemented. None is a gate clause for T10–T13.

### 2026-09-17 — Closing M2: repair, the broken socket, and two defects

Three fixes and one addition that finish the milestone's deliverables. PRODUCTION §1 lists M2 as "Snapped wood buildings, door permissions, containers, bedrolls, death, decay, durable saves"; all seven are implemented, and its exit gates — T03/T04 full, T10–T13 — are met apart from T12's satchel *item*, which PRODUCTION's own table places in M3.

**A live exploit, created by the previous change.** Door destruction became reachable with the blast work, and §10's "Breaking a door leaves its socket unavailable to everyone for 60 seconds" was still on the deferred list under D63. That turned a deferred nicety into a defender-side exploit: a breach that cost a satchel could be closed for free by re-hanging a door the instant it broke. The lockout applies to everyone, owner included, which is what "to everyone" says.

**A whole column of CONTENT §8 was missing.** Both explosives have a character damage figure on a *different* falloff from their structural splash — a satchel reaches 4 m for people and 3 m for walls — and the detonation only touched structures, so a raider standing on their own charge took nothing at all.

**A defect found by an intermittent test failure.** The placeholder hazard zone was centred on the spawn point, so every new player began taking exposure the moment they joined. The test that caught it asserted "exposure under 1 after joining", which was really measuring how loaded the machine was: it passed on a quiet run and failed on a busy one. Moving the zone twenty metres east makes the assertion exact, and the zone is now drawn and announced — an unmarked patch of ground that quietly damages you is worse than one you were already standing in.

| ID | Decision | Status and reason |
|---|---|---|
| D73 | The broken-socket lockout applies to everyone, including the owner | Required reading, and it supersedes the part of D63 that deferred it. §10 says "unavailable to everyone"; exempting the owner would return the exploit it exists to prevent |
| D74 | A repair is a channel, and the channel now carries what it is for | Proposed. §10's repair is the second thing in the game that holds interact, so the channel stopped assuming an item. An interrupted hold costs nothing, which is D36's rule for a bandage applied to the same machinery |
| D75 | A repair's cost and legality are recomputed at completion, not trusted from its start | Required. Two seconds is long enough for the wall to be hit again, for the raid lock to come on, or for the materials to be spent elsewhere. Charging what was planned two seconds ago would let a player start a repair and then spend the wood on something else |
| D76 | A fresh spawn is placed clear of hazards | Required reading. §12 places a *respawn* "outside structures/hazards"; there is no reading where a player's first spawn should be worse than the one they get after dying |

**Still open and not a gate clause for M2:** demolition's 120-second window (`placed_at_tick` is recorded, so it needs no migration), §10's metal tier swap, and the no-build polygons. The metal tier itself is Learn/Bench and waits on research (M3), as do windows, stairs, ramps and steps (D62).
