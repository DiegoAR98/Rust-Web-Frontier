# Initial GDD validation

Date: September 16, 2026 · Version 1.0 · Scope: documentation, not game implementation.

## Checks performed

- Read the discovered Unity project vault entry, selected work-log/context material, canonical GDD sections and existing review findings; separated sibling-project context from instructions for this new project.
- Cross-checked key historical claims against original Facepunch updates, including the durability/Repair Bench omission in the Unity design. Preserved late-Legacy system families and explicitly recorded western/browser divergences.
- Checked relative Markdown file links and GDD table-of-contents anchors; checked balanced fenced blocks.
- Parsed the item catalog and recipe rows: 68 individual items + 16 armor + 18 modular pieces = 102 unique item definitions; 45 explicit + 34 family recipes = 79 crafting recipes.
- Checked explicit recipe output/input IDs and loot entry IDs against the expanded catalog. Reviewed armor/building recipe families and acquisition paths separately.
- Compared the 30 learnable recipes with the two 15-entry schematic pools: complete coverage with no extra/missing payloads.
- Summed all six weighted loot tables: each totals 100.
- Recomputed cabin cost, furnace throughput/byproduct, exposure timing, satchel breach counts, armor damage, repair cost, home-upload arithmetic and milestone-hour sums.
- Verified 30 distinct acceptance scenarios, T01–T30, covering core mechanics, persistence, browser behavior, home ingress and operations.
- Reviewed cross-chapter rules for server-off versus player-offline time, research kit consumption, separate metal building items, support immunity, loot access, condition and crafting overflow.

## Findings corrected during authoring

1. Included item durability and repair instead of carrying over the Unity sibling's deliberate omission.
2. Kept every late crafting unlock reachable through a named schematic pool; research kits remain obtainable without circular self-research.
3. Made overflow containers cover crafting-escrow refunds as well as death, preventing unspecified item loss when capacity is full.
4. Corrected the calendar conversion of estimated developer hours to roughly 7–14 months at 15 focused hours/week before contingency.
5. Distinguished reliable committed inventory/lifecycle transactions from up-to-five-second rollback of continuous state after a hard crash.
6. Distinguished a fresh visitor's unavailable home-hosted page from the offline status shown by an already loaded browser page.

## Limits and next validation

No game code, browser build, server, firewall, network route or live database was created or tested in this task. No multiplayer, performance, balance, historical exact-numeric parity, voice relay or recovery test is claimed to have passed. The full automated runtime test scenarios are specifications for future implementation.

Static validation supports internal usability of this design; it cannot prove that it is fun, that 16 players fit the host's upload, or that every detailed rule perfectly reproduces an original Legacy patch. Those questions have explicit milestones, source caveats and release gates. M0's external two-browser connection and persistence proof is the next implementation step.

The repository and confirmed vault receive identical README and `docs/` files. The repository additionally contains its `.gitignore`; generated runtime data and secrets are excluded from future commits.
