# Content and balance specification

Version 1.0 · September 16, 2026 · Companion to [GDD](GDD.md).

Every value is proposed initial tuning. Tables define this game, not exact historical Rust data. IDs are stable lowercase snake_case. Counts are integer; condition/exposure/health may be fractional. Inputs are consumed once, outputs granted once. All listed baseline content is required for the complete release, even when temporarily absent from the vertical slice.

Catalog totals: **102 item definitions** (68 individually listed, 16 armor, 18 modular building pieces), **79 crafting recipes** (45 individually listed plus 34 armor/building recipes) and **30 learnable recipes**. Processing conversions, blood extraction and blueprint payload variants are separate behaviors, not additional item definitions or queue recipes.

## 1. Item catalog

“Default” means the recipe is known by every account at creation. “Learn” means its recipe requires either a matching schematic or research of the item. “Process” is a station conversion, not knowledge. “Loot” means no player crafting recipe. Raw resources have harvest sources. An item may have both a recipe and loot sources. Armor and modular building IDs expand in their respective tables below; they are not missing items.

| ID | Display name | Stack | Acquisition / purpose |
|---|---|---:|---|
| wood | Wood | 250 | Harvest piles/trees; fuel and building |
| stone | Stone | 250 | Harvest rocks; early tools/furnace |
| metal_ore | Metal ore | 250 | Harvest mixed rocks; furnace input |
| sulfur_ore | Sulfur ore | 250 | Harvest mixed rocks; furnace input |
| metal | Metal fragments | 250 | Process; guns, buildings and tools |
| sulfur | Sulfur | 250 | Process; powder chain |
| charcoal | Charcoal | 250 | Process wood fuel; powder chain |
| cloth | Cloth | 100 | Animal harvest and public loot; first clothes/medicine |
| hide | Hide | 100 | Animal harvest; stronger clothing |
| fat | Animal fat | 100 | Animal harvest; fuel |
| fuel | Rendered fuel | 100 | Default; furnace ingredient, explosives and lamps |
| powder | Black powder | 100 | Default; ammunition and explosives |
| blasting_compound | Blasting compound | 50 | Learn; satchel ingredient |
| raw_meat | Raw meat | 20 | Hunt; food-poisoning risk |
| cooked_meat | Cooked meat | 20 | Process; +400 calories, +5 health |
| burnt_meat | Burnt meat | 20 | Overcooking output; no benefit |
| beans | Tinned beans | 20 | Loot; +300 calories, −25 exposure |
| ration | Trail ration | 20 | Loot; +600 calories, +10 health, −50 exposure |
| water | Sealed water flask | 10 | Loot; −50 exposure; no thirst meter |
| cleanser | Assay cleanser | 10 | Loot; −200 exposure; fictional medicine |
| bandage | Bandage | 10 | Default; stops bleeding, no direct healing |
| field_dressing | Field dressing | 5 | Default; stops bleeding, 30 HP over 10 s |
| surgeon_kit | Surgeon kit | 5 | Learn; stops bleeding, 60 HP over 15 s |
| blood_sample | Blood sample | 10 | Blood-kit extraction; fictional medicine ingredient |
| blood_kit | Blood draw kit | 1 | Loot; costs 25 HP to create 1 blood_sample |
| rock | Rock | 1 | Spawn; primitive harvesting/melee, indestructible |
| stone_hatchet | Stone hatchet | 1 | Default; better wood/animal harvesting |
| iron_hatchet | Iron hatchet | 1 | Default; best wood/animal tool |
| pickaxe | Pickaxe | 1 | Default; best stone/ore tool |
| torch | Torch | 1 | Spawn/default; 600 s lit lifetime, no repair |
| flare | Signal flare | 10 | Default; thrown light, no damage, 120 s lifetime |
| survey_kit | Survey kit | 10 | Loot; single research charge |
| schematic | Schematic | 1 | Loot; payload = one learnable recipe ID |
| bow | Hunting bow | 1 | Default; projectile weapon |
| pipe_gun | Pipe shotgun | 1 | Default; one shell |
| revolver | Frontier revolver | 1 | Default; six rounds |
| coach_gun | Coach gun | 1 | Learn; two shells |
| repeater | Lever repeater | 1 | Learn; general mid/long-range combat |
| carbine | Patrol carbine | 1 | Learn; faster follow-up, lower per-hit damage |
| precision_rifle | Rolling-block rifle | 1 | Learn; single-shot precision |
| arrow | Arrow | 50 | Default; recoverable if embedded and reachable |
| pistol_ammo | Pistol cartridge | 100 | Default; revolver |
| shell | Shotgun shell | 50 | Default; pipe/coach guns |
| rifle_ammo | Rifle cartridge | 100 | Default; repeater/carbine/precision rifle |
| powder_bomb | Powder bomb | 5 | Learn; thrown anti-personnel explosive |
| satchel | Blasting satchel | 5 | Learn; attached breaching explosive |
| smoke_signal | Relief smoke signal | 5 | Loot; calls a contested supply drop |
| sight | Aperture sight | 1 | Learn; narrower aiming view, no damage bonus |
| scope | Short scope | 1 | Learn; 3× aiming view |
| dampener | Gunsmith dampener | 1 | Learn; fictional sound reduction attachment |
| campfire | Campfire | 5 | Default; cooking, charcoal, warmth |
| furnace | Furnace | 5 | Default; ore smelting and charcoal |
| workbench | Workbench | 5 | Default; craft speed and research |
| repair_bench | Repair bench | 5 | Default; item condition repair |
| bedroll | Bedroll | 5 | Default; personal spawn anchor |
| cot | Cot | 5 | Learn; faster spawn anchor |
| small_crate | Small crate | 5 | Default; 12 slots |
| large_crate | Large crate | 5 | Learn; 30 slots |
| stash | Buried cache | 5 | Default; 6 slots, hidden at distance |
| oil_lamp | Oil lamp | 5 | Default; light, rendered-fuel burn |
| spikes | Wooden spikes | 10 | Default; perimeter contact trap |
| shelter | Lean-to shelter | 5 | Default; temporary enclosed hut with door socket |
| wood_door | Wood door | 10 | Default; owner permissions |
| metal_door | Iron door | 10 | Default; stronger owner door |
| shutter | Wood shutter | 10 | Default; window insert |
| bars | Iron window bars | 10 | Default; fixed window insert |
| gateway | Timber gateway | 10 | Default; free-standing large door frame |
| gate | Timber gate | 10 | Default; gateway insert |

Blood kit use: 3-second channel, 30-second cooldown, requires health above 25, valid output space and no active bleed/poison/exposure sickness. Completion removes 25 health as direct cost without triggering bleeding and creates one sample. No infinite free-heal loop: a field dressing needs one sample and cloth for 30 healing, while surgeon kits need two samples plus other resources for 60. This preserves a resource-versus-health medical decision; it is not medical realism. Samples do not spoil in this baseline.

Durable items: stone_hatchet, iron_hatchet, pickaxe, bow, every firearm and every armor piece. Rock, blood_kit and attachments have no condition; torch has remaining burn time. Stations and pieces have placed HP, not inventory condition. All firearms begin unloaded. Loot durable items spawn at 60–100 current condition, maximum 100, uniformly sampled on the server.

## 2. Hand and workbench recipes

Inputs use the IDs above. All outputs are one unit unless `×N` is shown. Times are seconds per output batch. `Hand` is available anywhere and twice as fast near a workbench; `Bench` requires proximity and already lists its final time. Knowledge entries `Learn` produce their own schematic payload ID, identical to the output ID.

| Output | Inputs | Seconds | Station | Knowledge |
|---|---|---:|---|---|
| stone_hatchet | wood 15, stone 10 | 10 | Hand | Default |
| iron_hatchet | wood 20, metal 30 | 20 | Bench | Default |
| pickaxe | wood 20, metal 40 | 25 | Bench | Default |
| torch | wood 10, cloth 2, fuel 2 | 5 | Hand | Default |
| flare | cloth 2, powder 5, metal 2 | 5 | Hand | Default |
| fuel ×5 | fat 3, cloth 1 | 5 | Hand | Default |
| powder ×10 | sulfur 10, charcoal 20 | 5 | Hand | Default |
| blasting_compound | powder 15, sulfur 5, metal 10, fuel 3 | 10 | Bench | Learn |
| bandage | cloth 2 | 3 | Hand | Default |
| field_dressing | cloth 5, blood_sample 1 | 10 | Hand | Default |
| surgeon_kit | cloth 10, blood_sample 2, metal 5 | 20 | Bench | Learn |
| bow | wood 60, cloth 15 | 20 | Hand | Default |
| arrow ×4 | wood 8, stone 4 | 5 | Hand | Default |
| pipe_gun | wood 30, metal 40 | 30 | Bench | Default |
| revolver | metal 80, wood 20 | 45 | Bench | Default |
| coach_gun | metal 140, wood 40 | 60 | Bench | Learn |
| repeater | metal 200, wood 60, hide 10 | 90 | Bench | Learn |
| carbine | metal 240, wood 40, hide 10 | 90 | Bench | Learn |
| precision_rifle | metal 220, wood 60, hide 10 | 90 | Bench | Learn |
| pistol_ammo ×5 | metal 5, powder 5 | 5 | Bench | Default |
| shell ×5 | metal 5, powder 10 | 5 | Bench | Default |
| rifle_ammo ×5 | metal 10, powder 10 | 5 | Bench | Default |
| powder_bomb | powder 30, metal 20, cloth 5 | 20 | Bench | Learn |
| satchel | blasting_compound 10, cloth 15, fuel 5 | 30 | Bench | Learn |
| sight | metal 30 | 15 | Bench | Learn |
| scope | metal 80 | 30 | Bench | Learn |
| dampener | metal 100, cloth 10 | 30 | Bench | Learn |
| campfire | wood 30, stone 5 | 10 | Hand | Default |
| furnace | stone 100, wood 50, fuel 20 | 30 | Hand | Default |
| workbench | wood 100, metal 30 | 30 | Hand | Default |
| repair_bench | wood 80, metal 40 | 30 | Hand | Default |
| bedroll | cloth 20 | 15 | Hand | Default |
| cot | cloth 40, wood 50, metal 10 | 30 | Bench | Learn |
| small_crate | wood 40 | 10 | Hand | Default |
| large_crate | wood 100, metal 20 | 20 | Bench | Learn |
| stash | cloth 10, hide 5 | 10 | Hand | Default |
| oil_lamp | metal 15, cloth 2 | 15 | Hand | Default |
| spikes | wood 80 | 15 | Hand | Default |
| shelter | wood 80 | 20 | Hand | Default |
| wood_door | wood 30 | 10 | Hand | Default |
| metal_door | metal 120 | 30 | Bench | Default |
| shutter | wood 20 | 10 | Hand | Default |
| bars | metal 60 | 20 | Bench | Default |
| gateway | wood 150 | 30 | Hand | Default |
| gate | wood 80 | 20 | Hand | Default |

Everything not in this recipe table, the armor recipe family or modular building recipe table is not directly craftable. That includes rock, survey_kit, blood_kit, blood_sample, schematic, smoke_signal, water, cleanser, ration and beans; their acquisition is harvest, extraction or loot as declared. There is no hidden recipe for loot-only items.

## 3. Processing and fuel

| Station | Slots | Conversion | Fuel and byproduct |
|---|---|---|---|
| Campfire | 1 raw input, 1 wood fuel, 2 outputs | 1 raw_meat → 1 cooked_meat every 10 s | 1 wood per 10 s → 1 charcoal |
| Furnace | 2 ore inputs, 1 wood fuel, 3 outputs | Per input slot: 1 metal_ore → 2 metal OR 1 sulfur_ore → 2 sulfur every 5 s | 1 wood per 5 s → 1 charcoal |
| Oil lamp | 1 fuel slot | Light only | 1 fuel per 120 s, no charcoal |

Fire processing reserves output capacity for food/metal/sulfur and charcoal before each fuel quantum. At a fully blocked output, pause the entire station and do not consume fuel. An empty furnace can still convert wood into charcoal. No charcoal duplication from simultaneously counting wood as input and fuel. Rendered fuel is not a furnace/campfire fuel in this baseline; its sinks are equipment recipes and lamps.

Cooked food left in a lit campfire output for 60 consecutive processing seconds becomes burnt one unit at a time, oldest first. Removing the stack resets its cooking exposure; merging retains the older timestamp, so stack juggling cannot erase overcook history inside the station. Shut off the fire or transfer food to stop burning. A paused full-output station does not advance overcook time.

Worked furnace check: 12 metal_ore in each input, 12 wood and clear outputs produce 48 metal and 12 charcoal after 60 seconds. Inputs/fuel are empty. A single burning campfire converts 6 raw_meat plus 6 wood into 6 cooked_meat and 6 charcoal in 60 seconds when food is removed before its overcook deadline.

## 4. Gathering and wildlife

| Node | Total resource budget | Rock yield per swing | Respawn after depletion |
|---|---|---|---|
| Wood pile | wood 150 | wood 10 | 10 min |
| Standing tree | wood 100 | wood 5 | 20 min |
| Mixed rock | stone 100, metal_ore 60, sulfur_ore 40 | stone 5, metal_ore 3, sulfur_ore 2 | 15 min |
| Loose stone pickup | stone 10 | One E interaction | 5 min |

Stone hatchet multiplies wood yield ×2 and rock yield ×1; iron hatchet wood ×4 and rock ×1; pickaxe wood ×1 and rock ×3. Clamp each resource independently to the node's remaining budget. Rock swing interval 1 s, stone hatchet 0.9 s, iron hatchet 0.7 s, pickaxe 0.9 s; reach 2.5 m. Harvested item overflow drops into one nearby gather bag with a 10-minute timer and merging cap, never disappears. New hits are rejected if the overflow bag cannot legally exist under world limits.

| Creature | HP | Max chase/flee m/s | Hit / interval | Harvest pool | Special |
|---|---:|---:|---|---|---|
| Rabbit | 20 | 5.8 | None | raw_meat 2, cloth 2, fat 1 | Prey, flees early |
| Deer | 60 | 6.5 | None | raw_meat 8, cloth 8, hide 4, fat 4 | Main early food source |
| Boar | 80 | 4.8 | 10 / 1.5 s | raw_meat 6, cloth 4, hide 6, fat 6 | Defends when provoked |
| Wolf | 100 | 6.0 | 15 / 1.5 s | raw_meat 6, cloth 6, hide 8, fat 4 | Aggressive, leashes at 80 m |
| Bear | 250 | 5.0 | 30 / 2 s | raw_meat 16, cloth 10, hide 16, fat 12 | Slow strong threat; leash 60 m |
| Ash wolf | 150 | 6.0 | 20 / 1.5 s | Same as wolf | One hazard-loot roll |
| Ash bear | 350 | 5.0 | 35 / 2 s | Same as bear | Two hazard-loot rolls |

Predator notice range 25 m with line of sight, hearing up to 40 m for gathering and 80 m for firearms, melee reach 1.8 m. Prey notice range 20 m. Damage alerts the victim independently of detection. Dead animals do not respawn immediately: at least 15 minutes and no player within 30 m of their anchor. Full-map budget 24 living animals, of which at most four ash variants. At low population, preserve prey near starter regions before maintaining all ash spawns.

## 5. Weapons, ammunition and attachments

Values below are torso damage against an unarmored player, excluding bleeding. `Effective/max` are meters. Each firearm spends one corresponding cartridge/shell per shot; one shotgun shell produces all six pellets. All weapon fire is capped at the listed interval. Tool melee damage: rock 10, stone hatchet 15, iron hatchet 25, pickaxe 20. Torch strike deals 5 but has no ignition status effect.

| Weapon | Damage | Effective/max | Shot interval | Capacity / reload | Wear per shot |
|---|---:|---|---:|---|---:|
| bow | 40 | Projectile lifetime 3 s | 1.2 s draw | 1 / new draw | 0.25 |
| pipe_gun | 6 × 12 pellets | 10/30 | 1.5 s | 1 / 3 s | 0.4 |
| revolver | 30 | 35/90 | 0.45 s | 6 / 3 s | 0.2 |
| coach_gun | 6 × 14 pellets | 15/40 | 0.35 s | 2 / 1 s per shell | 0.3 |
| repeater | 38 | 70/180 | 0.6 s | 8 / 0.6 s per round | 0.2 |
| carbine | 28 | 60/150 | 0.3 s | 10 / 3.5 s | 0.25 |
| precision_rifle | 65 | 120/250 | 1.2 s | 1 / 3 s | 0.3 |

Bow speed 45 m/s with gravity 9.8 m/s²; arrows embed for 60 seconds and have a 50% server-rolled recovery chance after a hit. No recovered arrow is created until the original projectile is retired. Shotguns use a deterministic server-generated pellet cone of 6 degrees half-angle. Hip fire adds 2 degrees to gun spread; aiming uses 0.5 degree on revolver/repeater/carbine, 0.1 on precision rifle. Crouching halves the hip-fire addition but does not remove base spread.

Sight fits revolver/repeater/carbine, replacing their aiming view with 1.5×. Scope fits repeater/precision rifle for 3×. One optic socket. Dampener fits carbine/precision rifle only: audible gunshot radius ×0.6, damage ×0.9, muzzle flash reduced; no complete silence. One muzzle socket. Attach/detach takes 2 seconds, requires inventory space, cancels under damage, and retains attachments on dropped weapons. Attachments do not change structural damage. No attachment is essential to baseline progression.

Armor examples: revolver torso versus hide is `30 × 0.75 = 22.5` HP, five hits to kill from 100 before bleeding. Precision rifle headshot versus plated headgear is `65 × 2 × 0.60 = 78` HP, not an automatic one-hit kill. A naked headshot is 130. These examples are fixture targets, not playtested TTK claims.

## 6. Armor catalog and recipes

Four slots × four families = 16 items. IDs are exactly `cloth_head`, `cloth_torso`, `cloth_legs`, `cloth_feet`, similarly `hide_*`, `mining_*`, `plate_*`. Names: cloth hat/shirt/trousers/wraps; hide hat/jacket/chaps/boots; mining hood/coat/overtrousers/boots; plated hat/vest/chaps/boots. All stack 1 and have condition.

| Family | Per-hit-region bullet / melee protection | Exposure protection per piece | Warmth per piece | Knowledge / station |
|---|---|---:|---:|---|
| cloth | 5% / 10% | 0% | 5 | Default / Hand |
| hide | 25% / 30% | 5% | 10 | Default / Hand |
| mining | 10% / 10% | 22.5% | 8 | Learn each piece / Bench |
| plate | 40% / 40% | 2.5% | 6 | Learn each piece / Bench |

Explosion armor reduction is half the torso piece's bullet protection. Arrows use bullet protection. Legs cover leg hits and feet cover foot hits; arm hits use torso protection. Broken pieces contribute zero to all modifiers. Exposure and warmth sum across valid worn pieces; projectile protection never sums across slots.

| Slot suffix | Cloth inputs / seconds | Hide inputs / seconds | Mining inputs / seconds | Plate inputs / seconds |
|---|---|---|---|---|
| head | cloth 8 / 10 | hide 10, cloth 5 / 15 | cloth 15, metal 15 / 20 | metal 30, hide 10 / 25 |
| torso | cloth 20 / 15 | hide 25, cloth 10 / 25 | cloth 30, metal 30 / 30 | metal 80, hide 20 / 40 |
| legs | cloth 15 / 12 | hide 20, cloth 8 / 20 | cloth 25, metal 20 / 25 | metal 60, hide 15 / 35 |
| feet | cloth 7 / 8 | hide 10, cloth 4 / 12 | cloth 10, metal 10 / 15 | metal 25, hide 8 / 20 |

Full sets: cloth 20 warmth; hide 40 warmth and 20% exposure resistance; mining 32 warmth and 90% exposure resistance; plate 24 warmth and 10% resistance. Mining gear dominates hazardous sites but is weak in gunfights; plated armor does the opposite. Mixed sets are legal.

## 7. Modular building catalog

Nine forms × two tiers = 18 inventory pieces. IDs are `wood_foundation`, `wood_steps`, `wood_pillar`, `wood_wall`, `wood_doorway`, `wood_window`, `wood_ceiling`, `wood_stairs`, `wood_ramp`, and the same suffixes under `metal_`. Stack limit 10. Wood recipes are default/Hand; each metal form is individually Learn/Bench. Times are per piece. Placed support rules are in GDD §10.

| Suffix | Wood cost / time / HP | Metal cost / time / HP | Combat behavior |
|---|---|---|---|
| foundation | wood 60 / 15 s / 2000 | metal 100 / 30 s / 4000 | Combat immune; decays |
| steps | wood 20 / 8 s / 500 | metal 40 / 15 s / 1000 | Destructible |
| pillar | wood 15 / 5 s / 1000 | metal 25 / 10 s / 2000 | Combat immune; decays |
| wall | wood 40 / 10 s / 1000 | metal 80 / 20 s / 2000 | Destructible |
| doorway | wood 40 / 10 s / 1000 | metal 80 / 20 s / 2000 | Destructible; insert dies with frame |
| window | wood 40 / 10 s / 1000 | metal 80 / 20 s / 2000 | Destructible; insert dies with frame |
| ceiling | wood 50 / 15 s / 1000 | metal 90 / 25 s / 2000 | Destructible; cascades dependents |
| stairs | wood 50 / 12 s / 600 | metal 75 / 20 s / 1200 | Destructible |
| ramp | wood 40 / 10 s / 600 | metal 60 / 15 s / 1200 | Destructible |

One closed 1×1 wood cabin uses foundation 1, pillars 4, walls 3, doorway 1, ceiling 1 and wood door 1: **360 wood**, before stations/storage. A lean-to plus wood door is **110 wood**. These are the construction-only early-game pacing fixtures.

| Insert/deployable | Placed HP | Special rule |
|---|---:|---|
| wood_door | 500 | One satchel at contact |
| metal_door | 1000 | Two satchels at contact |
| shutter | 300 | Opens/closes, blocks projectiles when shut |
| bars | 800 | Bullet rays pass actual gaps; blocks bodies |
| gateway / gate | 1200 / 750 | Large matching socket |
| shelter | 750 | Enclosed warmth; uses shelter decay schedule |
| campfire / oil_lamp | 100 / 100 | Does not damage nearby players simply by proximity |
| furnace | 500 | No warmth bonus; visibly lit |
| workbench / repair_bench | 500 / 500 | Destroying cancels/pauses dependent actions |
| bedroll / cot | 200 / 400 | Owner-only spawn, no time skipping |
| small_crate / large_crate / stash | 250 / 500 / 150 | 12 / 30 / 6 slots |
| spikes | 300 | 10 HP per contact second, plus bleed; all players affected |

A buried cache can be revealed by any player looking at its location within 2 m for 2 seconds. Burial takes 3 seconds and requires no active raid lock; it hides appearance only, not invulnerability or server existence. No client receives its contents without actual access. Terrain constraints prevent burying beneath foundations.

## 8. Structural damage and explosive economy

Tools deal their base melee damage ×0.5 to wood and ×0.05 to metal; bullets/arrows deal base damage ×0.1 to wood and ×0.02 to metal. Armor does not apply to structures. Supports marked combat immune ignore these and all explosions. Fire is not a spreading-destruction system. Spikes do not damage structures.

| Explosive | Fuse | Throw/place | Contact structure damage | Character damage |
|---|---|---|---:|---|
| powder_bomb | 3 s after throw | Projectile, 15 m/s launch, gravity 9.8 | 100 | 80 at ≤1 m, linear to 0 at 5 m |
| satchel | 8 s after accepted placement | Attach within 2.5 m; 2 s arm | 600 | 100 at ≤1 m, linear to 0 at 4 m |

Structural splash is the contact amount scaled linearly to zero at 3 m for satchels and 4 m for bombs, subject to pre-explosion occlusion. A directly attached satchel uses full 600 damage on its target. Global throw/arm cooldown is 2 seconds after a completed throw/arm. No unlisted direct-impact damage. No disarming in baseline; abandoned armed charges persist until their fuse resolves.

At full health and contact: wood door 1 satchel, wood wall/ceiling or metal door 2, metal wall/ceiling 4. An airlock of two intact metal doors costs four minimum. Shotgun pellets do not multiply structural damage beyond the actual pellet damage sum.

One satchel costs, expanded: 200 sulfur (150 through powder + 50 direct), 300 charcoal, 100 metal, 35 fuel and 15 cloth. Fuel rounds up to seven five-unit batches: 21 fat and 7 more cloth. Therefore from raw resources it requires 100 sulfur_ore, 50 metal_ore, **at least 300 wood converted to charcoal**, 21 fat and 22 cloth. Furnace ore throughput fits inside that charcoal-producing fuel run; do not double-count mandatory smelting fuel. Two satchels double those amounts. This deliberately makes a gun less expensive than a raid. Acquisition time needs real playtesting; the document does not assume an hours-to-raid outcome from resource counts alone.

## 9. Loot tables

Each roll chooses one entry by weight (rows sum to 100), then chooses an inclusive uniform integer count. Rolls are independent and duplicates allowed. Containers have sufficient slots for their full roll count; merging is optional, truncation forbidden. Items never arrive already studied or automatically bound. Loot tables are public design data; actual generated contents are server-only until accessed.

| Table | Entries: item or nested pool, count, weight |
|---|---|
| provisions | beans 1–2: 30; ration 1: 20; water 1–2: 20; cloth 5–10: 20; bandage 1–2: 10 |
| tools | metal 10–25: 25; iron_hatchet 1: 15; pickaxe 1: 15; survey_kit 1: 20; blood_kit 1: 10; schematic_common 1: 15 |
| medical | bandage 2–4: 30; field_dressing 1–2: 25; surgeon_kit 1: 10; cleanser 1–2: 25; blood_kit 1: 10 |
| arms | pistol_ammo 10–20: 25; shell 5–10: 15; rifle_ammo 10–20: 20; revolver 1: 15; coach_gun 1: 10; repeater 1: 5; schematic_common 1: 10 |
| hazard | survey_kit 1: 20; mining_piece 1: 25; schematic_rare 1: 20; cleanser 2–3: 15; blasting_compound 1–3: 10; carbine 1: 5; precision_rifle 1: 5 |
| relief | schematic_rare 1: 20; survey_kit 1–2: 15; plate_piece 1: 15; satchel 1: 10; precision_rifle 1: 10; ration 2–4: 10; surgeon_kit 1–2: 10; smoke_signal 1: 10 |

Nested pools have equal probability among their listed eligible entries:

- `mining_piece`: the four mining armor IDs.
- `plate_piece`: the four plate armor IDs.
- `schematic_common`: coach_gun, repeater, cot, large_crate, surgeon_kit, sight, and the nine metal building forms (15 payloads).
- `schematic_rare`: carbine, precision_rifle, scope, dampener, powder_bomb, satchel, blasting_compound, four mining pieces and four plate pieces (15 payloads).

All 30 learnable recipe payloads have a loot source. Research provides an additional route from eligible exemplars. No progression-critical default recipe requires a schematic. Hazard crates at low-exposure edges can provide the first mining clothing; the full protective set is not required to reach every source of itself.

| World container | Rolls | Table | Empty/despawn respawn delay |
|---|---:|---|---|
| Food box | 2 | provisions | 10 min |
| Tool chest | 2 | tools | 15 min |
| Doctor chest | 2 | medical | 15 min |
| Ammunition trunk | 2 | arms | 20 min |
| Assay strongbox | 2 | hazard | 25 min |
| Relief crate | 6 | relief | Event only |

Map allocation of 48 public anchors: 12 food, 10 tools, 8 medical, 10 arms, 8 assay. Coyote Wash gets food/tools only; Mercy Crossing includes medicine and tools; Black Spur hosts arms and lower-intensity assay positions; Saint's Assay/Widow's Cut hold the remaining hazard anchors. Ash wildlife use hazard table rolls independently of normal carcass harvest.

At one or two active players, keep 24 anchors active, including at least one of every public container type; at 3–8 use 36; at 9+ use all 48. Choose fixed fair regional subsets, not a player-following spawn service. A population decrease stops future spawns at disabled anchors and lets existing crates expire normally. Minimum respawn delays never shrink with population.

## 10. Economy invariants and tuning method

Sources: gathering, wildlife, loot, starter kits and station production. Sinks: ammunition, food, consumables, explosives, lost bags, condition replacement, decay and building expansion. Transfers, deaths, container spills and repair are not item-creation sources except declared recipe outputs. No currency beyond barter.

Log aggregate source/sink quantities per item class, median time to shelter/first gun/first schematic, condition-repair use, raid cost, deaths by source and unused recipes. Do not balance exclusively for highly skilled groups. Run solo, duo and eight-person tests against the same catalog. Adjust yields/weights/costs in data, record the reason and date, and rerun the numerical fixtures in PRODUCTION.

Reject a catalog release if an input ID is unknown, a learnable recipe lacks acquisition, a stack is nonpositive, a conversion can create unlimited free resources through a cycle, a loot table weight sum differs from 100, or an example disagrees with its owning table. Declared aliases such as `metal` versus displayed “Metal fragments” must resolve to one ID.
