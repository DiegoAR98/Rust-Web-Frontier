# Production plan, risks and acceptance

Version 1.0 · September 16, 2026 · Part of the [GDD](GDD.md).

The project is currently documentation only. Milestones below are proposed work, not accomplished features. Estimates are effective developer hours including integration and basic testing; AI assistance does not eliminate review, real multiplayer playtests or asset work. At 15 focused hours/week, the total range is roughly 7–14 months before contingency, not a delivery commitment.

## 1. Milestones and dependencies

| Milestone | Dependencies | Deliverable | Hours | Exit gates |
|---|---|---|---:|---|
| M0 Feasibility | None | Browser scene, two-client authoritative movement/item transfer, external home ingress, stable identity, sleeper and restart proof; decide dependency versions | 30–50 | T01–T04, T17 smoke checks |
| M1 Survival loop | M0 | Gathering, inventory, food/cold/exposure/bleed, campfire/furnace, queues, basic wildlife | 50–90 | T05–T09, T20 |
| M2 Shelter and loss | M1 | Snapped wood buildings, door permissions, containers, bedrolls, death, decay, durable saves | 60–100 | T03–T04 full, T10–T13 |
| M3 Conflict and knowledge | M2 | Bow/revolver, condition/repair, research, hazard loot, satchel raid, 500 m vertical slice | 60–100 | T14–T16, T18; 8-player human slice |
| M4 Full baseline content | M3 | Entire catalog, both building tiers, all weapons/armor, full map and wildlife variants, supply events | 70–130 | T19–T21; catalog and economy acceptance |
| M5 Presentation and access | M3; final integration after M4 | Consistent original art, audio, controls/accessibility, full UI, browser loading/performance | 100–220 | T22–T24 and art/asset audit |
| M6 Social and operations | M2; integration after M4 | Voice/NAT relay, moderation, backup/restore, host runbook, security hardening | 50–100 | T25–T29 |
| M7 Full-release validation | M4–M6 | Measured 16-player capacity, real sessions, restart/abuse testing, balance iteration | 60–100 | All gates, no unresolved critical defects |

Total **480–890 hours**, plus 25% contingency (**600–1113 hours** rounded up at the high end). If bought/commissioned art is chosen, cash cost and integration effort need separate estimates. No asset purchases, relay subscriptions or domains are approved or purchased by this document.

M0 is a stop-and-decide gate: timebox failed WSS, collision or ingress experiments. If no external playable connection with persistence can be demonstrated inside the allocation, revise the transport/ingress plan or the hosting requirement before spending on final art. Do not quietly change the product to LAN-only or single player.

## 2. Implementation order inside each milestone

Implement one vertical behavior through intent → validation → simulation → persistence → replication → visible UI. For example, gathering is not complete when its pure function returns wood; two browsers must fight over the last node yield and receive exactly one combined result. Use greybox art until rules and interactions work.

Before merging a gameplay change: identify its owning GDD rule and data rows, add meaningful rule/integration tests for the risk, run affected checks, show the behavior in a browser, and update the decision log when behavior intentionally changes. Source code tests must not merely repeat constants without asserting the player-visible outcome.

Future code work uses small commits and synchronizes GDD revisions to the vault. This initial document task is committed/pushed to main as requested; later implementation branching follows the development session's instructions. Never mark a feature finished only because code compiled or a disconnected test harness passed.

## 3. Acceptance scenarios

| ID | Scenario | Required result |
|---|---|---|
| T01 | Connect two browsers from different networks to home host | Both enter same world, see movement and exchange an item; no engine/plugin/player installer |
| T02 | Submit forged speed, out-of-range hit, old session and duplicate commands | No impossible movement/damage; duplicates reuse prior outcomes; old session cannot act |
| T03 | Two players take the final item and final node yield simultaneously | One conserved total; no negative stacks, duplicate item IDs or phantom success |
| T04 | Force-kill process after acknowledged transfer/placement/death | Restore committed outcomes once; continuous uncommitted state rollback ≤5 s; no free starter kit |
| T05 | Start at 1200 calories, walk for 60 s, then sprint 60 s; no other drains | 1185 then 1140 calories; at zero, 0.5 HP/s starvation; no thirst/stamina drain |
| T06 | Medium hot-ore zone, no gear, 100 s | 500 exposure; 1000 exposure causes 1 HP/s; full mining set reaches 500 after 1000 s |
| T07 | Naked lowland night versus full cloth set | Naked deficit 20 blocks regen/adds 0.25 cal/s; cloth warmth 20 removes cold penalty |
| T08 | Bleed, cancel bandage by damage, then complete use | Cancel consumes nothing; successful use consumes one and stops bleed; no additive bleed exploit |
| T09 | Furnace inputs/fuel from CONTENT example, then repeat with full outputs | 48 metal/12 charcoal in 60 s; blocked cycle consumes no inputs/fuel |
| T10 | Build specified 1×1 cabin | Exactly 360 wood before stations; legal snapped geometry; no unsupported ceiling |
| T11 | Stranger attempts door operation, socket attachment and box access through wall | Unauthorized door/socket denied; through-wall loot denied; accessible open-box loot allowed |
| T12 | Blast full-HP wood door, wood wall, metal door and metal wall | Minimum contact satchels 1/2/2/4; immune foundation/pillar unaffected; no through-barrier splash |
| T13 | Kill/disconnect/reconnect, destroy bedroll, use nearby second anchor | Full loot preserved; one sleeper/body identity; destroyed anchor unavailable; shared cooldown enforced |
| T14 | Research unknown eligible item; retry already known, broken and loot-only targets | One kit consumed, exemplar retained, one recipe learned; invalid attempts consume nothing |
| T15 | Repair 0/100 revolver with correct inputs | Spend 40 metal/10 wood, result 90/90; repair cap declines; ≤20 max rejects |
| T16 | Shoot hide torso and plated head with example weapons | Revolver 22.5 direct damage; precision plated head 78; armor applies per region |
| T17 | Stop host for two wall-clock hours with active timers, then resume | No decay, fuel, crafting, cooldown, bag expiry or explosive time advances while stopped |
| T18 | 8-player slice at 150 ms RTT, 30 ms jitter and 1% induced packet loss | No state divergence/duplication; usable aim/movement; correction p95 <0.5 m during ordinary legal travel |
| T19 | Validate catalog and generate fixed-seed loot samples | IDs resolve; 30 learnable recipes reachable; all weights total 100; quantity bounds respected |
| T20 | Animals detect, chase, lose path and die; two players harvest final hit | No wall attacks/teleports; finite harvest paid once; wildlife budgets maintained |
| T21 | Event schedule, smoke cooldown, shutdown mid-flight and mid-fuse | One delivery/detonation; correct remaining timers; signal refusal consumes nothing |
| T22 | Low/reference clients traverse dense base and contested POI for 30 min | Meets stated FPS/memory/transfer targets on documented devices; low settings preserve cover |
| T23 | New browser denies mic, unlocks pointer, changes tab, loses graphics context | Text/game remain usable; no stuck input; recovery/error flow understandable; world never pauses |
| T24 | Rebind, keyboard-navigate menus, raise UI scale, disable flash/bob | Actions remain reachable, text does not clip, status and placement do not rely on color alone |
| T25 | Voice between restrictive networks through selected TURN path | Proximity and mute work; unauthorized distant peers do not receive voice; bandwidth cap measured |
| T26 | Run for two hours with 16 simulated clients, then real crowded encounter | Tick p95 <25 ms/p99 <45 ms; no unbounded memory/send queues; measured home uplink has headroom |
| T27 | Backup live world; restore separately; try corrupt/future-schema save | Consistent restore; errors refuse safely; original save never silently replaced with empty world |
| T28 | Fill disk / block DB writes, spam joins/chat and malformed payloads | Mutations stop safely on storage failure; bounded resource usage; no crash or private-data leak |
| T29 | Inspect unrelated client packets and unauthenticated admin route | No private box/account data; management denied; secrets absent from browser bundle/log exports |
| T30 | 5 new players + returning-player recovery session | ≥4/5 build shelter and cook within 20 min; returning basic recovery ≤30 min; record actual results |

Test harnesses should manipulate simulation time explicitly instead of waiting 48 real hours for decay. Separate tests verify that the live scheduler feeds that same clock correctly. Loss/jitter injection needs a network proxy/router test path; browser devtools latency alone does not represent all network failure modes.

## 4. Numerical design fixtures

These formulas must stay consistent with their owning tables when tuning changes:

- Cabin wood: `60 + 4×15 + 3×40 + 40 + 50 + 30 = 360`.
- Furnace: `2 input slots × 12 ore × 2 metal = 48 metal`; `12 fuel quanta × 1 charcoal = 12 charcoal`.
- Exposure: `500 / 5 = 100 s` unprotected; `500 / (5×0.1) = 1000 s` protected.
- Satchel contact requirements: `ceil(HP / 600)` gives 1, 2, 2, 4 for HP 500/1000/1000/2000.
- Revolver hide torso: `30×(1−0.25) = 22.5`; precision plated head: `65×2×(1−0.4) = 78`.
- Full broken revolver repair: `ceil(80×0.5) = 40 metal`; `ceil(20×0.5) = 10 wood`.
- State upload at 16 players: `16×30×8/1000 = 3.84 Mbps`, before overhead/assets/voice.
- Learnable payload coverage: 13 explicit learned item recipes + 8 armor + 9 metal forms = 30.

## 5. Release gates and playtests

Blocking defects: inventory duplication/loss outside stated expiry, ownership bypass, impossible-hit exploit, broken save recovery, progression deadlock, unavailable external host route, severe repeated crash, unusable input/menus, missing baseline system or sustained failure of the advertised population target. Cosmetic variation and optional WebGPU support do not block baseline.

Run the slice with humans before adding the full catalog. Run at least three full-baseline sessions on separate days, including one restart while players have valuable inventories and one planned offline interval. Include a novice, a solo player and a cooperating group. Publish the actual browser/device/player-count results; lower the advertised cap if 16 cannot pass. Do not use “works on the developer machine” as multi-browser evidence.

Record completion of core loops: first meal, closed shelter, bedroll, furnace, first firearm, first research, successful raid, failed raid, offline death and recovery. Interview whether loss felt understandable, whether resource trips produced encounters, and whether the western weapons preserved enough Legacy tension. Retune before inventing more progression systems.

## 6. Risk register

| Risk | Impact | First mitigation / decision point |
|---|---|---|
| Home network has CGNAT or blocked inbound ports | Nobody outside LAN joins | M0 external test and WSS tunnel/relay selection |
| Low upload or competing home traffic | Jitter, bad combat, stalled joins | M0 measurement, asset throttling, lower cap |
| WSS head-of-line delay | Visible corrections under loss | M0/M3 network harness; bounded queues, evaluate transport only with evidence |
| Persistent simulation too large | Tick starvation and saves that stall play | Entity caps, AOI, staged load tests before map art |
| Catalog dependency deadlock | Survival or research impossible | Static acquisition graph + novice playtest |
| Western gun ladder loses Legacy feel | Theme succeeds but reference target fails | M3 gunfight tests; explicitly assess missing automatic-fire role |
| Durability/raid grind overtuned | Players stop taking risks | Source/sink metrics; controlled rebuild and raid sessions |
| Permanent supports encourage griefing | Terrain clogged/unfair raid denial | Socket ownership, caps, decay, monitored admin cleanup |
| No players online | Little social tension | Smaller active map/loot subset; schedule test groups; no AI faction scope explosion |
| Asset packs clash or lack module dimensions | Incoherent visual game | Small art bible and custom modular kit, license audit |
| Voice NAT/relay failures | Social feature silently missing | M6 TURN test and explicit release blocker |
| Host sleeps/crashes/storage fails | Unavailable server or lost world | Clock semantics, transactional persistence, backups and restore drills |
| Browser/GPU variability | Access goal fails for some computers | Capability screen, low profile, actual compatibility matrix |
| Scope underestimated | Endless preproduction | M0 proof, slice-first delivery, fixed baseline/no western feature creep |

## 7. Decisions still requiring evidence

The design selects defaults so implementation can begin. Actual host hardware/uplink, direct ingress versus tunnel, intended play group size, art sourcing budget, public versus friends-only launch, microphone relay provider and final commercial title remain unverified. None prevents writing the GDD. Network/hardware choices block capacity promises; asset/voice/title choices must close before their corresponding release claims. Record measured outcomes in SOURCES_AND_DECISIONS rather than silently treating these defaults as user-approved purchases or tested facts.
