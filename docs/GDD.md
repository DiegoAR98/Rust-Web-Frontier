---
title: Rust Web Frontier - Game Design Document
version: '1.0'
date: 2026-09-16
status: implementation-design
tags: [game-design, western, survival, multiplayer, browser]
---

# Rust Web Frontier — Game Design Document

**Working title:** Rust Web Frontier. **Player-facing working name:** Frontier: Dustfall. Both are provisional. **Owner:** Diego Araujo. **Status:** complete initial design, not a finished or playtested game.

Build a small, persistent western survival world that friends can enter through a browser link. A player starts with a rock, a torch and bandages; gathers wood and stone; hunts for food and cloth; cooks, smelts, crafts and researches; builds a vulnerable cabin; and fights over the resources needed to protect it. Other people can steal the entire result. Knowledge and familiarity with the land make the next recovery faster.

The intended experience is Rust Legacy's compact, readable survival sandbox. Browser delivery, original western content, a smaller server population and finite world budgets are the adaptations. This is a real first-person 3D game, with multiplayer from its first playable milestone, authored through code and assets without Unity or Unreal.

## Navigation and specification rules

1. [Product and design pillars](#1-product-and-design-pillars)
2. [Legacy fidelity contract](#2-legacy-fidelity-contract)
3. [Western world](#3-western-world)
4. [Player journey and progression](#4-player-journey-and-progression)
5. [Movement and interaction](#5-movement-and-interaction)
6. [Survival](#6-survival)
7. [Gathering and hunting](#7-gathering-and-hunting)
8. [Inventory and ownership](#8-inventory-and-ownership)
9. [Crafting, research and repair](#9-crafting-research-and-repair)
10. [Building and decay](#10-building-and-decay)
11. [Combat and raiding](#11-combat-and-raiding)
12. [Death, respawning and sleepers](#12-death-respawning-and-sleepers)
13. [World, loot and events](#13-world-loot-and-events)
14. [Social play](#14-social-play)
15. [Interface and accessibility](#15-interface-and-accessibility)
16. [Art and audio](#16-art-and-audio)
17. [Multiplayer and hosting experience](#17-multiplayer-and-hosting-experience)
18. [Scope and success](#18-scope-and-success)

Companion chapters are [CONTENT](CONTENT.md), [TECHNICAL](TECHNICAL.md), [PRODUCTION](PRODUCTION.md) and [SOURCES_AND_DECISIONS](SOURCES_AND_DECISIONS.md). All numerical values are **proposed starting balance**, not claims about exact Legacy values. Times mean real seconds while the server simulation runs unless explicitly described as fictional time. “Server off” means no simulation advancement. “Player offline” means the server can still advance and the player's possessions remain vulnerable.

Historical facts are distinguished from this game's decisions in the source register. The fidelity reference is **late Legacy, after the February 2014 removal of zombies and introduction of durability, before the Experimental branch became the default**. Exact patch-level reproduction is not claimed. Features seen in current Rust, experimental-branch devblogs or modern Legacy recreations are not automatically evidence of original Legacy behavior.

## 1. Product and design pillars

| Attribute | Decision |
|---|---|
| Genre | First-person, full-loot, open-world multiplayer survival and base raiding |
| Platform | Desktop web browser, keyboard and mouse; no installer or engine editor for players |
| Initial compatibility | Current stable Chrome, Edge and Firefox on Windows; macOS Safari/Chrome and Linux Chrome/Firefox are full-release test targets |
| Population | 8-player first playable; 16 concurrent full-release target; 24 only after measured capacity tests |
| Hosting | One authoritative server process on Diego's computer; his browser is an ordinary client |
| Availability | Accessible while computer, server, network and ingress are running; no always-on promise |
| Map | One authored 1.5 km × 1.5 km basin; 500 m × 500 m vertical slice |
| Style | Stylized, low-detail 3D frontier, readable silhouettes and deliberate distance fog |
| Session | 20-minute supply excursion; 60–120-minute social session; persistent world across sessions |
| Business model | Free private prototype; no store, premium currency, battle pass or paid advantages |
| Content | Fictional western violence, animal hunting, blood effects with reduced-blood option; clothed characters |

**A small ladder with high stakes.** A player should understand the resource chain in one evening. Complexity comes from opponents and geography, not nested crafting currencies.

**Every journey risks something.** Hunting provides food and clothes, mining fuels ammunition, and dangerous sites provide knowledge. No protected stash or safe town removes that tension.

**Shelter changes the problem.** A first cabin solves cold and storage, but its smoke and silhouette advertise wealth. Metal buys time; it does not buy invulnerability.

**The place becomes familiar.** Mountains, road forks, mine structures and other players' houses replace minimaps and quest markers.

**Keep the systems; simplify their representation.** Reduce map size, NPC counts, texture resolution and animation variety before removing crafting, raiding, research or persistence. Do not implement the full game in single player and hope to add networking later.

“Anyone can play from a computer” is the access goal, not a claim that every GPU, browser policy or connection will run the game. A preflight screen detects graphics support and input limitations before joining.

## 2. Legacy fidelity contract

The Unity sibling provides useful intent, not inherited authority over this project. Its offline-first architecture, AI rival crews and modern industrial island do not carry over. Its omission of durability also does not carry over: Facepunch documented durability, armor wear and the Repair Bench on February 25, 2014. [Original update](https://rust.facepunch.com/news/25th-febuary-update).

| System family | Frontier implementation | Fidelity treatment |
|---|---|---|
| First-person movement, basic spawn kit | Rock, torch, two bandages; walking, sprinting, crouching, jumping | Preserve loop; tune controller for browser latency |
| Calories, health, bleeding and cold | Complete mutually interacting survival simulation | Preserve; no separate thirst or stamina bars |
| Radiation and protective gear | Fictional hot-ore exposure, prospecting detector and protective mining clothes | Preserve dose/protection/medicine/loot-gate function |
| Raw-food sickness and healing | Cooking, food poisoning, bandages, medical kits, passive recovery | Preserve decisions; explicit cooldowns are adaptation |
| Trees, piles, ore, carcasses | Wood, stone, metal ore, sulfur ore, meat, cloth, hide and fat | Preserve production dependencies |
| Inventory, containers, dropped loot | Slot/stack inventory, belt, worn gear, lootable storage and corpses | Preserve; transactional networking added |
| Crafting and smelting | Timed queue, campfire, furnace, workbench | Preserve single-bench simplicity |
| Blueprints and research kits | Found schematics; survey kit researches an exemplar near bench | Preserve discovery progression; deterministic one-charge research |
| Item condition and repair | Wear on tools, guns, armor; repair with declining maximum condition | Include in full scope and vertical slice |
| Snapped building and stockpiled pieces | Individually crafted wood/metal pieces, pillars, doors, ceilings, stairs | Preserve; separate pieces, no modern upgrade hammer |
| Damage-resistant supports | Foundations and pillars immune to combat; decay can remove them | Preserve Legacy-like raid topology; finite height cap added |
| Raiding and explosives | Breach doors or walls using powder charges, steal contents | Preserve sulfur/charcoal resource sink |
| Decay | Abandoned structures decay, no cupboard/upkeep tax | Preserve purpose; explicit activity timer is adaptation |
| Death and sleeping bags | Full inventory loss, persistent learned schematics, bedroll/cot respawn | Preserve; cooldown sharing prevents spawn spam |
| Offline sleepers | Disconnected bodies remain killable and lootable | Preserve danger; host shutdown freezes entire world |
| Wildlife and rare hostile variants | Deer, boar, wolves, bears; ash-sick wolves/bears at hazard sites | Late-Legacy target, no zombies |
| Contested loot settlements | Mining camps, assay office, depot and hazardous mine | Preserve geography and exposure versus reward |
| Supply drops and signals | Distant balloon delivers parachuted relief crate; smoke signal summons it | Preserve public contest with western fiction |
| Social uncertainty | Local voice, local/global text, friendly fire, voluntary door permissions | Preserve cooperation and betrayal |
| Modern military weapons | Revolvers, shotguns, repeaters, precision rifle | Largest deliberate divergence: no portable automatic rifles |
| Modern Rust expansion systems | No tech tree/scrap currency, tool cupboard, electricity, farming, vehicles or NPC shops | Excluded from baseline |

Original Legacy's crafted structural items and absence of tool cupboards are documented in the retrospective [Legacy overview](https://rust.fandom.com/wiki/Rust_%28Legacy%29). Its other detailed claims are not treated as verified numeric specifications. This GDD intentionally chooses explicit rules when the archive is ambiguous.

No horses at launch, despite the setting: mounts would change traversal, encounter density, animation and networking. No train simulation, law-enforcement AI, bounty progression, quest campaign, town economy or bandit base director. These can only be revisited after full Legacy-loop acceptance.

## 3. Western world

**Dustfall Basin**, an invented late-19th-century-inspired frontier, was abandoned after its mining company opened a seam of “hot ore.” Dust and contaminated machinery still make the assay works and deep mine dangerous. Relief contractors sporadically send unmanned supply balloons into the valley, but nobody restores order. Prospectors, drifters and scavengers are the players.

This is stylized alternate history, not a historical simulation. Hot ore explains the radiation-equivalent mechanic, primitive detectors, protective suits and fictional cleansing medicine. Those treatments are game fiction, not medical claims. Clothing, timber construction, revolvers, iron furnaces, oil lamps and blasting powder carry the western identity. Avoid making real ethnic groups into generic enemies; hostile humanoids are other players.

| Region | Function and landmarks | Resources and danger |
|---|---|---|
| Coyote Wash | New arrivals, dry riverbed, split sandstone arch | Loose wood/stone, rabbits, low-value crates; not a safe zone |
| Juniper Flats | First cabins, windmill and broken water tower | Wood piles, deer, medium sight lines |
| Timber Gulch | Dense western pine pocket, sawmill chimney | Best wood/cloth routes; wolves and ambushes |
| Ironback Ridge | Switchback trail and three black peaks | Ore, cold nights, bears; exposed silhouettes |
| Mercy Crossing | Abandoned settlement, church bell frame | Food, medical and tool crates; multiple exits |
| Black Spur Depot | Rail terminus and derelict freight cars | Weapon/ammunition/schematic loot; moderate hot-ore zone |
| Saint's Assay Works | Smelter stacks and orange tailings | Better research loot; severe exposure |
| Widow's Cut | Large mine mouth and hoist tower | Best protection/charge loot; strongest exposure and ash wildlife |

Bound the map with steep terrain and visible exclusion barriers. Water is shallow and walkable; no swimming, diving or thirst system. A boundary warning precedes a server-enforced movement boundary. Do not make a harmless-looking puddle an unexplained instant-death trap.

The western skin must survive a screenshot with the HUD hidden: terrain, architecture, clothing, tools and weapons should identify the setting. Story appears through short signs and environmental damage, never compulsory quest dialogue.

## 4. Player journey and progression

Core loop: **leave shelter → gather or contest loot → decide whether to push farther → return with something at risk → craft, learn or reinforce → choose a more valuable expedition**. Death interrupts the carried inventory, not the learned knowledge or world.

| Time for a new player | Intended accomplishment | Dependencies |
|---|---|---|
| 0–5 minutes | Learn movement, hit a pile, craft stone hatchet | Spawn resources within a short walk |
| 5–15 minutes | Hunt or loot food, light fire, place shelter and door | Wood and one accessible food source |
| 15–30 minutes | Secure bedroll and crate; cook first meal | Cloth from wildlife or public loot |
| 30–60 minutes | Build a small cabin, furnace and workbench | Fat, cloth, stone and metal ore |
| 1–2 hours | Carry bow/pipe gun/revolver; raid minor loot site | Fuel/ammo chain and basic medical supplies |
| 2–4 hours | Learn first scarce schematics, wear hide or mining gear | Contested sites and research kits |
| 4–8 hours | Metal doors, repeaters, explosives and planned raids | Sulfur, charcoal, knowledge and allies |
| Ongoing | Recover, fortify, contest drops, form rivalries | Players generate the endgame |

These are playtest targets, not forced unlock timers. A lucky stolen rifle can arrive in minute ten. It is usable immediately but must be researched to reproduce it. Blueprints are per account, per server, and persist through death; a deliberate blueprint wipe can reset them. No XP, level, classes, skill points or scripted victory.

Early recovery relies on default recipes and public raw materials; essential furnace, bandage and ammunition recipes cannot depend on a rare drop. Rare schematics expand options. A fully raided veteran can rebuild basic survival equipment without winning a loot lottery.

First-session hints are optional, event-driven and temporary: gather, craft, cook, shelter, bedroll. They grant no resources and reveal no hidden players or routes. A death recap explains the damage source, lost equipment and available respawn choices without revealing an enemy base's location.

## 5. Movement and interaction

| Action | Binding | Rule |
|---|---|---|
| Move/look | WASD/mouse | First person; horizontal movement resolved on server |
| Sprint/crouch/jump | Shift/Ctrl/Space | Hold/toggle options; no stamina bar |
| Interact | E | 2.5 m use ray, line of sight required |
| Use/aim | Left/right mouse | Weapon, tool, consumable or placement ghost |
| Reload | R | Also rotates placement ghost when building |
| Inventory/crafting | Tab / C | Pointer released; world continues |
| Belt | 1–6 / wheel | Server validates selected usable item |
| Text/push-to-talk | Enter / V | Voice requires separate microphone opt-in |
| Menu | Escape | Unlocks pointer; never pauses server |

Walk 3.5 m/s, sprint 5.5, crouch 1.8; gravity 20 m/s²; jump takeoff 6 m/s; step height 0.35 m; maximum walkable slope 45 degrees; capsule radius 0.35 m, standing height 1.8 m and crouched height 1.2 m. Stand-up checks headroom. No bunny-hop acceleration, prone, climbing, mantle or slide. Sprint disallows firing, aiming and item-use channels; releasing sprint allows those actions immediately.

Fall damage begins below a vertical impact velocity of −10 m/s and deals `min(100, 8 × (abs(vY) − 10))` health. Landing on another character does not grant a boost. All collision meshes are shared in meaning between client prediction and server simulation; clients cannot choose their own speed, height or destination.

Click **Enter world** to lock pointer and enable audio. Escape, tab switching or permission refusal never silently re-locks it. Lost focus sends neutral input; the server also neutralizes stale inputs after 250 ms. Browser suspension or closure is a disconnect, not a pause or teleport to safety.

## 6. Survival

This section owns survival tuning. All accumulations clamp at their stated bounds; health at zero triggers one death transaction. Bleeding, exposure and starvation damage bypass clothing armor. Consumables and armor modifiers are specified in CONTENT.

| Variable | Range / spawn | Behavior |
|---|---|---|
| Health | 0–100 / 100 | Damage, medicine and conditional regeneration |
| Calories | 0–3000 / 1200 | Drain 0.25/s standing or walking; sprint replaces base with 0.75/s |
| Exposure | 0–3000 / 0 | Hot-ore dose reduced by worn protection; explicit toxicity threshold |
| Bleeding | 0–2 HP/s / 0 | Highest active wound rate, refreshed duration; no additive stacks |
| Cold deficit | Derived / regional | Environment pressure minus clothing/fire/shelter warmth |

Every valid melee swing additionally costs 1 calorie. At zero calories, starvation deals 0.5 HP/s. No starvation damage above zero. Passive regeneration is 0.1 HP/s when calories are at least 800, no damage was received in the previous 10 seconds, and no bleeding, poisoning, exposure sickness or cold deficit of 20+ is active. A nearby campfire raises regeneration to 0.4 HP/s under the same conditions. Each regenerated HP consumes two additional calories. Medical healing does not consume calories.

**Cold.** Lowlands have pressure 0 by day and 20 by night; Ironback has 30 by day and 60 at night. Rain adds 10. A fully enclosed room gives 20 warmth, a held lit torch 10, and a fire within 4 m with unobstructed warmth ray gives 40. Fires do not stack with each other; clothing and shelter do. Deficit 1–19 adds 0.1 calorie/s; 20–39 adds 0.25/s and blocks regeneration; 40+ adds 0.5/s and deals 0.25 HP/s. Dry heat is visual atmosphere, not another survival meter.

**Hot ore.** Zone rates are 2/5/10 exposure units per second for low/medium/high. Effective intake is `rate × (1 − totalProtection)`, capped at 90% protection. Highest overlapping zone wins; zones never multiply accidentally. After 10 seconds outside all positive-dose zones, exposure falls 2/s. At 500+ exposure regeneration stops; damage is `min(5, max(0, exposure − 500) × 0.002)` HP/s. Thus an unprotected player reaches sickness after 100 seconds at medium intensity, while a full mining set takes 1000 seconds. Medicine reduces existing dose; it never gives temporary immunity. Visual dust, warning placards, detector ticks and the HUD communicate the boundary.

**Bleeding.** Every damaging arrow or bullet has a server-rolled 25% chance to apply 1 HP/s for 10 seconds. Melee and animal bites have 20% for 0.5 HP/s for 10 seconds. Spike contact applies 1 HP/s for 10 seconds without a roll. Repeat wounds take the maximum rate and latest expiry. Explosions apply 1 HP/s for 10 seconds if their actual character damage is positive. Bandage or medical use clears bleeding on completion. Armor reducing damage to zero prevents a bleed roll.

**Food poisoning.** Eating raw meat always applies 20 seconds of sickness at 0.5 HP/s, blocks regeneration and gives only 50 calories. Repeated consumption refreshes, not stacks, the duration. Cooking makes food safe. Burnt meat gives no food benefit and is discardable. Consumables cannot resurrect a dead character.

Use channels: food/water/cleanser 1 second, bandage 2, field dressing 3, surgeon kit 4. Damage, sprint, death or disconnect cancels without consumption; successful completion consumes one unit and applies effects atomically. A shared 2-second post-use cooldown prevents instant stacked medicine. Medkit healing over time uses the highest active healing rate, never sums; a new kit replaces the remaining heal budget. Direct damage ends medical regeneration. This is an explicit adaptation from historical instant-medkit behavior for readable browser combat.

## 7. Gathering and hunting

Wood piles reward immediate gathering, standing trees provide reliable fallback wood, and rock deposits provide stone plus ores. CONTENT defines harvest budgets and per-tool output. Server-validated swing timing, reach and line of sight determine every successful hit. One node cannot pay its final resources twice to competing players.

A node's remaining inventory is finite. Depleted piles and ore rocks disappear and schedule a respawn; trees retain a stump. Respawns use authored anchors, avoid structures and characters, and retry after 60 seconds if blocked. Spawn resources are not privately reserved. No paid resources, offline accrual, procedural caves or mining minigame.

Animals use simple wander/flee/chase/attack/return states. Prey flee when approached or hurt; predators detect by sight, proximity and loud noise. Wolves can catch a sprinting player briefly, so terrain, shelter and weapons matter. Animals cannot attack through closed walls. If pathfinding fails for 5 seconds, retreat rather than teleport or hit through geometry. Ash variants supply rare loot and normal carcass resources but remain wildlife, not undead.

A dead animal has a harvest pool and a separate optional loot pouch. Harvesting consumes the pool over four valid tool hits; each hit grants one quarter with integer remainders assigned to the final hit. Unharvested carcasses expire after 10 online minutes. Human bodies do not provide edible meat, fat or crafting resources.

## 8. Inventory and ownership

Player capacity is 24 backpack slots, six belt slots and four worn slots: head, torso, legs and feet. Belt slots also hold normal stacks; worn slots only accept matching clothing. No carry-weight or encumbrance system. The default clothed body mesh grants no armor or warmth.

Move, swap, split, equip, consume, drop and quick-transfer are server transactions. Items with condition, attachments or weapon-loaded ammunition never stack. Other stack limits appear in CONTENT. Craft inputs come only from backpack and belt; no automatic pulling from nearby boxes. Dragging in the UI creates a pending request, not authoritative ownership.

Containers have shared access, slot revisions and server-ordered transfers. Two users may look at one box; only the first valid transfer of a contested item succeeds. Access is rechecked on every transfer for distance, line of sight, existence and player state. Walking away closes the UI. No looting through walls or opening the same container from an old reconnect session.

Boxes are not magically private. Any person who reaches a box can open it; doors supply security. Sleeping bodies can be looted at use range. Awake living players cannot be looted. Player-dropped bags have a 10-minute lifetime, player death bags 30 minutes; the timer never refreshes on inspection. All timers freeze with the server. Destroyed containers spill one bounded bag holding the actual remaining items.

A weapon stores loaded ammunition separately from backpack ammo. Dropping, dying or transferring it carries loaded ammunition and attachments with it; reloading never manufactures ammunition. An item in a pending craft or repair transaction cannot also be moved or dropped. Overflow/drop containers use the same 40-visible-slot plus paged overflow representation as corpses when necessary; their total payload is bounded by the originating transaction, never an arbitrary client count. This ensures canceling a large escrowed queue can return every input without unlimited world pickups.

## 9. Crafting, research and repair

The queue has six entries and processes one at a time. Each entry can contain up to 100 identical recipe units. Ingredients for each entire entry are escrowed when accepted. Outputs complete one recipe unit at a time. Cancellation refunds all unstarted units plus the incomplete unit in full; it never refunds completed output. Full inventory pauses output completion with a visible reason and retains escrow. No silent loss, infinite ground drops or infinite offline crafting.

Walking is allowed while crafting. Leaving required bench range pauses that recipe; ordinary recipes continue. A workbench within 3 m and line of sight halves the listed duration of hand recipes. Bench-only recipe durations are already their final values. No tiers or research-point currency. Death releases all remaining escrow into the death container; disconnect cancels and returns escrow to the sleeper inventory, with excess in a single nearby loot bag.

Campfire and furnace have explicit input/fuel/output slots and run independently of player crafting while the server runs. Their all-or-nothing processing steps reserve output capacity before consuming an input or fuel quantum. A full output pauses processing and fuel use; deliberate charcoal production is allowed with an empty furnace input. Exact conversion arithmetic is in CONTENT. Fires emit light and smoke visible to others.

**Schematics.** A found schematic is a physical, tradable item carrying one recipe ID. Study takes 2 seconds and consumes it only if that knowledge is new. Known duplicates remain tradable. Only specified advanced recipes have schematic IDs; knowing an item does not grant an entire armor set.

**Survey kit research.** At a workbench, spend one survey kit and 5 seconds examining an eligible inventory item to learn its recipe. Success is guaranteed; the exemplar is retained, the kit is consumed. No chance-based destruction. Default-known, loot-only, already-known and broken items cannot be researched. The kit itself is loot-only and cannot research itself. These rules deliberately differ from the Unity sibling's consumed exemplar and craftable research-kit loop. A research attempt must hold the exemplar/kit stable and revalidate bench access on completion.

**Condition.** Every durable tool, weapon and armor item begins at 100 current and 100 maximum condition. Tool swings that hit consume 0.2, melee weapon hits 0.25, shots consume the per-weapon value in CONTENT, and a struck armor piece loses `0.1 × pre-armor hit damage`. A last valid use can reduce condition to zero; subsequent uses fail. Broken armor gives no protection or warmth and stays visible as broken until removed. Condition and attachments are per-instance state.

At a repair bench within 3 m, repair takes 5 seconds and costs a proportion of the item's original resource recipe: for each ingredient, `ceil(baseQuantity × 0.5 × (oldMax − current)/100)`. Repair reduces max condition by 10 points and sets current to that new max; reject if new max is not greater than current, or old max is 20 or less. No repairs of consumables, stations or building item stacks. Installed building repair has its own rule. A 0/100-condition revolver therefore costs 40 metal fragments and 10 wood to become 90/90. Repeated repairs ultimately require replacement, sustaining the resource economy.

## 10. Building and decay

Craft each piece into an inventory item, equip it and place its ghost. A server-accepted placement consumes one item. Wood and metal pieces are separate recipes. Replacing a wood piece with metal is a validated one-for-one swap using a crafted metal piece, preserves support and orientation, returns nothing, and is prohibited while raid-locked. There is no generic building plan or upgrade hammer.

Grid cells are 4 m square and 3 m high with four corner pillars. Foundations anchor to permitted terrain; pillars attach to foundation or supported ceiling corners. Walls, doorways and windows require the two adjacent pillars. Ceilings require four pillars below. Stairs require a supported cell and clear headroom; ramps/steps attach to foundation edges. Build height is six storeys. Authored slopes and legal foundations must permit a small base near each starter region.

Foundation and pillar combat immunity is intentional. Other pieces can be damaged, including ceilings; there is no weak-side damage. Piece HP, material multipliers and explosive breach counts are in CONTENT. Removing a support by decay or allowed demolition cascades removal to dependents in a deterministic order and spills container contents once. No floating loot-bearing rooms, duplication or infinite support cycles.

No tool cupboard, radius ownership bubble or forced upkeep box. A new detached foundation must be at least 1 m from any existing foundation edge. Only a building owner or explicit builder can attach to its grid or replace its pieces; enemies may build separate raid towers outside this collision clearance. This socket rule and height cap are declared anti-grief/performance adaptations, not assertions of exact Legacy behavior.

Owner doors default closed and private. The owner can grant named player IDs door access and, separately, building permission through a local interaction. Permissions persist and can be revoked immediately. There are no team outlines, map pins or automatic immunity; a door left open lets anyone walk through. Only the authorized builder can install a replacement door. Breaking a door leaves its socket unavailable to everyone for 60 seconds.

No-build polygons cover POIs, roads, arrival anchors and event landings, with boundaries exposed by the placement ghost. Reject overlap with players, sleepers, containers, resource anchors or world geometry. Minimum non-overlapping spacing plus max 400 structural pieces and 100 deployables per owner, max 1000 pieces in one connected building, and a 6000-world-entity build/deployable cap bound growth. Reaching a cap produces an understandable error before consumption.

**Repair and demolition.** Hold interact on an owned damaged piece for 2 seconds to restore up to 100 HP, paying `ceil(original material cost × restoredHP / maxHP × 0.5)` of each resource. A building-wide raid lock lasts 60 seconds after any hostile damage and blocks repair, tier swaps, demolition and new attached construction. Owner damage also starts the lock. Demolition is allowed for 120 seconds after placement, requires no dependent pieces and an empty container, and returns the piece. After the window, use normal combat on destructible pieces or wait for decay; supports require admin cleanup if permanent placement was mistaken. The ghost must make this restriction clear.

**Decay.** Every 60 seconds, awake connected owners or authorized builders within 50 m refresh their building cluster's activity timestamp; sleepers do not. Shelter grace is 3 online hours followed by 6 hours to decay from full to zero; wood structures/deployables use 24+24; metal structures 48+48. At each minute after grace, subtract the appropriate fraction of max HP. Activity refresh pauses future decay without healing. Nonempty containers still decay and spill loot; there is no immortal full-box exception. Inventory condition does not decay while stored. No offline-time catch-up after a stopped host.

## 11. Combat and raiding

Weapons feel deliberate: silhouette recognition, readable muzzle flash, limited ammunition, distinct reports and meaningful reloads. CONTENT lists health damage, range, fire interval and condition wear. Firearms use server hitscan with range falloff; bows and thrown explosives use server projectiles. No client-declared hit, damage, target or ammunition count is trusted.

Humanoid hit regions are head ×2, torso ×1 and limbs ×0.75 before region-specific armor. Explosion damage has no head multiplier. Projectile protection comes from the armor covering that hit region, not the sum of the entire set. Falloff scales firearms from full damage at listed effective range to half at maximum range; beyond maximum, the shot cannot hit. Shotgun pellet damage sums before a single bleed roll.

No downed/revive state: zero HP is death. Friendly fire is always on. No aim assist, hit outlines through cover, kill streaks or retained combat loot. Recoil is a short, visible kick; no elaborate memorized spray pattern. Reload is server-timed; cancellation retains previously loaded rounds. Shell-fed firearms insert one shell at a time. Ammunition moves into the magazine only at the matching server reload step.

The ordinary ladder is rock/hatchet → bow/pipe gun → revolver/shotgun → repeater → precision rifle. The repeater fills the general combat role of Legacy's military rifles, but cannot reproduce automatic fire. This gap is accepted for western identity, rather than hidden by claiming identical gunplay. A rare combat carbine is the rapid-fire late weapon, still manually aimed and nonautomatic.

Blasting chains consume sulfur, charcoal, cloth, fuel and metal. Throwing a powder bomb is anti-personnel pressure; attaching a blasting satchel is reliable breaching. Explosions are loud enough to attract counter-raiders. No offline-player shield: raiding a sleeping owner's base is allowed while the server is running. Server shutdown protects everyone equally by freezing the world.

Explosion damage uses distance falloff and line of sight from its center. One intact structural barrier occludes further structural blast damage; resolve the blocking set from the pre-explosion world so a single explosion cannot destroy a door and then damage behind it retroactively. The attached target receives its specified contact damage once. A single satchel is consumed when armed, not when it explodes; restart restores remaining fuse.

Destroying a box produces its loot; destroying a bedroll removes that spawn; destroying a workbench removes its crafting benefit without unlearning recipes. Counters are layered doors, protected bedrolls, redundant supplies, offsite caches, listening and allies. No base is promised unraidable.

## 12. Death, respawning and sleepers

Death atomically cancels actions, moves backpack, belt, worn gear, loaded weapons and craft escrow into one corpse inventory, removes the live character, and marks the account dead. Respawn grants the starter kit exactly once and resets survival stats. Learned recipes and surviving placed property persist. Corpses hold 40 slots plus a noninteractive overflow manifest that pages into those slots as items are removed; overflow cannot be lost due to queued crafting.

Random respawn selects a valid Coyote Wash or Juniper perimeter anchor, preferring one at least 75 m from active enemies and outside structures/hazards. If none are safe, use the least exposed valid anchor, communicate that the world is dangerous, and never spawn inside collision. There is no invulnerability period to exploit during raids.

Bedrolls and cots are personal respawn anchors, maximum five combined per account. Bedroll cooldown is 300 seconds, cot 120. A new anchor starts on its full cooldown. Using one starts its timer and applies at least that cooldown to the owner's other anchors within 50 m. Death does not reset a remote anchor's existing timer. Cooldowns use persisted simulation time. Name anchors locally; do not expose their coordinates to other players.

Disconnect leaves a sleeper at the last authoritative position immediately; stop motion and cancel actions. Existing bleeding, poison and exposure finish under normal rules, but sleeper calorie drain, passive regeneration and cold damage are disabled. External attacks, hazard-zone dose and wildlife can still kill it. Sleeper state does not expire while alive; corpses follow the 30-minute rule. If a supporting surface disappears, the sleeper falls under authoritative collision.

Reconnect authenticates the same account, replaces any older active session and resumes the same body. If killed while away, show a death recap and respawn options. No fresh duplicate body, fresh starter kit or inventory rollback on reconnect. An explicit **Leave world** screen explains that the body remains.

## 13. World, loot and events

The map has a traversable road loop connecting safe-resource regions to increasingly exposed loot sites. “Safe-resource” describes environmental pressure, not PvP immunity. Every major POI needs two approaches, two exits, one audible landmark, cover against long-range fire, and a route that does not require already owning its rarest protective item.

Author 16 arrival anchors, 160 gather anchors, 48 public loot anchors and eight potential supply landings. Activate approximately 24 animals across the map, with 12 higher-frequency brains near players. Use region budgets rather than spawning a fresh set per player. CONTENT gives per-node contents, loot weights and respawn rules; full map totals are ceilings to test, not a claim of current performance.

Loot containers refill only after empty/despawn, their timer elapses and no player/sleeper is within 20 m. Leaving one item cannot block an anchor forever: an opened container despawns 10 minutes after first opening, then starts the normal respawn delay. Remaining contents are removed; warn in the UI when a public crate is near expiry. Player storage never uses that rule. Normal loot remains viable at one player; population scaling changes active anchors, never secretly weakens opponents or grants raid resources.

Each 60-minute online day contains 45 minutes of light and 15 of darkness. Start the world at morning. Supply event eligibility occurs every 60 online minutes with 1+ connected player; an empty server defers and retries in 5 minutes rather than stockpiling events. Choose one legal landing, signal the balloon 120 seconds before arrival, and deliver one crate. A smoke signal schedules an extra event after 120 seconds, subject to one active event and a 10-minute global signal cooldown; reject without consuming when unavailable.

The balloon is an animated background prop on an authored route, not a vehicle. The crate is an authoritative entity descending to a validated landing. All players in visual/audio range can contest it; no owner entitlement. No GPS marker appears. Drop contents expire after 20 minutes; one event can never deliver twice across reconnect or restart. Weather is clear, cloudy or light rain with a 10-minute minimum duration; no tornadoes, lightning damage or seasonal simulation.

## 14. Social play

Local text range is 50 m, global text is server-wide, and proximity voice fades between 10 and 40 m. Voice is push-to-talk, optional and independently mutable per player. Text remains fully usable without microphone access. Full release includes voice; the earliest vertical slice can use text while the voice transport is validated.

Display names are 3–20 characters, nonunique, normalized and escaped; account ID supplies identity. Names appear only within 15 m when aiming at an unobstructed player, not through walls. The roster lists connected names and latency, never positions or equipment. Alliances are informal and permissions explicit; friendly fire and betrayals remain possible.

Trade by dropping items or using a shared crate. There is no guaranteed escrow trade, NPC currency, auction house or vending machine. A player can take the deal and run. Moderation tools include mute, kick, ban, whitelist and report-to-host; exploit reports should carry timestamps and entity/action IDs, not hidden player inventories. Admin spawning and invulnerability are logged and reserved for tests, not silent competitive use.

## 15. Interface and accessibility

Screens: landing/status, compatibility check, account/recovery, connecting/loading, HUD, inventory/gear, crafting/research, container, door permissions, death/respawn, settings and connection-lost. Player-facing wording explains the current action; technology names and raw socket errors stay in diagnostics.

HUD: crosshair, six-slot belt, health/calories/exposure values, contextual cold/bleed/sickness icons, interaction text, short action timer and connection quality warning. Exposure gauge appears in a zone or while dose is positive. Condition appears on durable item icons. No minimap, compass by default, teammate wall outlines or raid alert that reveals an unseen attack.

Inventory/crafting must support mouse and keyboard, quick transfer, stack split, tooltips and visible ingredient counts. Show all recipes; unknown ones are clearly locked. A crafting pause states “Move closer to a workbench” or “Make room in your pack.” Building ghosts use shape plus text, not color alone; show why a location is blocked and whether supports will be permanent after the correction window.

Rebind movement/use actions, invert mouse, sensitivity, 70–100 degree horizontal FOV, hold/toggle aim/sprint/crouch, 80–150% HUD scale, separate audio sliders, voice mute, subtitles for authored cues, reduced flashes, reduced blood, disable head bob and reduced motion. Enemy-generated cues remain tied to the same audible event/range; accessibility captions do not become unlimited-range radar. Text contrast and scalable DOM menus are prioritized; full nonvisual competitive FPS accessibility is not promised.

Loss of graphics context attempts one resource restore; failure shows reconnect. A network failure freezes speculative gameplay, shows the last state as stale, retries with bounded backoff and explains that the character may remain exposed. It never lets the browser continue independently and merge fabricated progress later.

## 16. Art and audio

Palette: sun-bleached ochre, rust-red stone, dry pine green, dark iron and warm lantern orange. Safe and dangerous loot locations differ in silhouette and sound, not simply saturation. Mining hazards use yellow dust and ringing detector ticks; the highest-value areas remain readable on low settings.

Production set: one modular terrain kit, one western settlement kit, wood and metal construction kits, eight weapon/tool silhouette families, four clothing families across four slots, six wildlife variants, first-person arms, one shared third-person humanoid rig, containers/stations and restrained VFX. Ash animals reuse wolf/bear rigs with visibly altered silhouettes/skin. Remote players and sleepers have bodies; local first-person presentation uses arms without requiring full-body IK.

Animation requirements: locomotion, crouch, jump/land, idle/aim/fire/reload, tool strike, bow draw/release, throw, consume, hit/death, sleeper, animal wander/flee/attack/death. Gameplay timing belongs to server action definitions, not animation events; visible frames follow the authorized timings.

Use glTF assets, shared materials, LOD meshes, instancing, compressed textures and pooled effects. Author exact 4 m building modules rather than stretching unrelated asset packs. Asset records include creator, source, license, modification and permission for distribution in downloadable browser bundles. Use original or appropriately licensed content; do not copy Rust names, map, code, sounds or art. This is a production requirement, not a legal opinion on the final title.

Audio is tactical: footsteps change by ground, gun families have distinct close and distant reports, furnace smoke comes with a recognizable hiss, arrows are quieter than firearms, and explosives advertise raids. Target audible radii: crouch steps 5 m, walk 15, sprint 30, gathering 60, bow 30, handgun 200, rifle 350, satchel 500. Occlusion attenuates but does not perfectly silence walls. Maximum 32 simultaneous effects with priority for threats. Background music is menu-only by default; ambient wind/insects/creaking wood fill gameplay space.

## 17. Multiplayer and hosting experience

The home machine is a dedicated authority even if Diego is not playing. Closing his browser does not close the world. Stopping the server does. No host migration, peer authority or external service is required to simulate gameplay.

When the machine is off, players cannot enter or continue playing. A previously loaded page can show “Server unavailable”; if the page itself is hosted at home, a brand-new visitor may see a browser connection error. An optional tiny externally hosted status page can improve this later without moving the game simulation off Diego's computer.

While the server runs, world events, resource refresh, production, decay, sleepers and raids continue even if an individual player is away. When the process stops, every gameplay timer freezes, including explosives, cooldowns and exposure. Restart resumes persisted remaining times; no burst of overdue drops or decay. Host suspension is treated as downtime, not hours of accumulated simulation debt.

Persistent identity, saves, backups, connection authentication, internet ingress, crash semantics, anti-cheat boundaries, browser performance and measured capacity gates are specified in [TECHNICAL](TECHNICAL.md). The host's actual upload speed and reachable network path must be tested before accepting any population target.

## 18. Scope and success

| Delivery | Included | Exit condition |
|---|---|---|
| Network proof | 2–4 browsers, home-host connection, movement, shared item, sleeper, restart | M0 acceptance passes over a real external connection |
| Vertical slice | 8 players, 500 m terrain, all survival categories, basic hunting/crafting/building/repair, bow/revolver, research, one hazard site, explosive raid | A player can start, build, lose everything, reconnect and recover |
| Complete baseline | 16-player target, entire CONTENT catalog, full map, all weapons/armor/building variants, loot/drop loop, voice, moderation, saves and host runbook | All required PRODUCTION gates pass |
| Later only | 24+ players, horses, additional maps, procedural world, controller/mobile, NPC factions, economy/campaign systems | Separate decision after baseline evidence |

The vertical slice is intentionally incomplete content; it is never relabeled “all Legacy mechanics shipped.” Full release keeps every baseline system family in the fidelity table. Cuts require a recorded design revision identifying which player decision is lost.

Playtest success: four of five first-time testers obtain safe cooked food and a closed shelter in 20 minutes without developer intervention; an informed returning player recovers basic food/bedroll/tool kit within 30 minutes after a total loss; five-player sessions generate voluntary cooperation and at least one contested expedition without scripted objectives; no reproducible duplication or restart reset survives the release gate. Combat fairness, performance and host reliability are measured separately in PRODUCTION.

There is no promise of a release date or guaranteed low-end performance. The next action is the small network/persistence proof, because failure there determines the whole project's feasibility more directly than a polished western screenshot.
