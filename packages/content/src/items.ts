export interface ItemDefinition {
  id: string;
  displayName: string;
  stack: number;
  /** Durable items carry condition and never stack, regardless of `stack`. */
  durable: boolean;
}

// Transcribed from CONTENT.md section 1. Values are proposed initial
// balance, not historical claims (see CONTENT.md's own preamble).
export const ITEMS: ItemDefinition[] = [
  { id: 'wood', displayName: 'Wood', stack: 250, durable: false },
  { id: 'stone', displayName: 'Stone', stack: 250, durable: false },
  { id: 'metal_ore', displayName: 'Metal ore', stack: 250, durable: false },
  { id: 'sulfur_ore', displayName: 'Sulfur ore', stack: 250, durable: false },
  { id: 'metal', displayName: 'Metal fragments', stack: 250, durable: false },
  { id: 'sulfur', displayName: 'Sulfur', stack: 250, durable: false },
  { id: 'charcoal', displayName: 'Charcoal', stack: 250, durable: false },
  { id: 'cloth', displayName: 'Cloth', stack: 100, durable: false },
  { id: 'hide', displayName: 'Hide', stack: 100, durable: false },
  { id: 'fat', displayName: 'Animal fat', stack: 100, durable: false },
  { id: 'fuel', displayName: 'Rendered fuel', stack: 100, durable: false },
  { id: 'powder', displayName: 'Black powder', stack: 100, durable: false },
  { id: 'blasting_compound', displayName: 'Blasting compound', stack: 50, durable: false },
  { id: 'raw_meat', displayName: 'Raw meat', stack: 20, durable: false },
  { id: 'cooked_meat', displayName: 'Cooked meat', stack: 20, durable: false },
  { id: 'burnt_meat', displayName: 'Burnt meat', stack: 20, durable: false },
  { id: 'beans', displayName: 'Tinned beans', stack: 20, durable: false },
  { id: 'ration', displayName: 'Trail ration', stack: 20, durable: false },
  { id: 'water', displayName: 'Sealed water flask', stack: 10, durable: false },
  { id: 'cleanser', displayName: 'Assay cleanser', stack: 10, durable: false },
  { id: 'bandage', displayName: 'Bandage', stack: 10, durable: false },
  { id: 'field_dressing', displayName: 'Field dressing', stack: 5, durable: false },
  { id: 'surgeon_kit', displayName: 'Surgeon kit', stack: 5, durable: false },
  { id: 'blood_sample', displayName: 'Blood sample', stack: 10, durable: false },
  { id: 'blood_kit', displayName: 'Blood draw kit', stack: 1, durable: false },
  { id: 'rock', displayName: 'Rock', stack: 1, durable: false },
  { id: 'stone_hatchet', displayName: 'Stone hatchet', stack: 1, durable: true },
  { id: 'iron_hatchet', displayName: 'Iron hatchet', stack: 1, durable: true },
  { id: 'pickaxe', displayName: 'Pickaxe', stack: 1, durable: true },
  { id: 'torch', displayName: 'Torch', stack: 1, durable: false },
  { id: 'flare', displayName: 'Signal flare', stack: 10, durable: false },
  { id: 'survey_kit', displayName: 'Survey kit', stack: 10, durable: false },
  { id: 'schematic', displayName: 'Schematic', stack: 1, durable: false },
  { id: 'bow', displayName: 'Hunting bow', stack: 1, durable: true },
  { id: 'pipe_gun', displayName: 'Pipe shotgun', stack: 1, durable: true },
  { id: 'revolver', displayName: 'Frontier revolver', stack: 1, durable: true },
  { id: 'coach_gun', displayName: 'Coach gun', stack: 1, durable: true },
  { id: 'repeater', displayName: 'Lever repeater', stack: 1, durable: true },
  { id: 'carbine', displayName: 'Patrol carbine', stack: 1, durable: true },
  { id: 'precision_rifle', displayName: 'Rolling-block rifle', stack: 1, durable: true },
  { id: 'arrow', displayName: 'Arrow', stack: 50, durable: false },
  { id: 'pistol_ammo', displayName: 'Pistol cartridge', stack: 100, durable: false },
  { id: 'shell', displayName: 'Shotgun shell', stack: 50, durable: false },
  { id: 'rifle_ammo', displayName: 'Rifle cartridge', stack: 100, durable: false },
  { id: 'powder_bomb', displayName: 'Powder bomb', stack: 5, durable: false },
  { id: 'satchel', displayName: 'Blasting satchel', stack: 5, durable: false },
  { id: 'smoke_signal', displayName: 'Relief smoke signal', stack: 5, durable: false },
  { id: 'sight', displayName: 'Aperture sight', stack: 1, durable: false },
  { id: 'scope', displayName: 'Short scope', stack: 1, durable: false },
  { id: 'dampener', displayName: 'Gunsmith dampener', stack: 1, durable: false },
  { id: 'campfire', displayName: 'Campfire', stack: 5, durable: false },
  { id: 'furnace', displayName: 'Furnace', stack: 5, durable: false },
  { id: 'workbench', displayName: 'Workbench', stack: 5, durable: false },
  { id: 'repair_bench', displayName: 'Repair bench', stack: 5, durable: false },
  { id: 'bedroll', displayName: 'Bedroll', stack: 5, durable: false },
  { id: 'cot', displayName: 'Cot', stack: 5, durable: false },
  { id: 'small_crate', displayName: 'Small crate', stack: 5, durable: false },
  { id: 'large_crate', displayName: 'Large crate', stack: 5, durable: false },
  { id: 'stash', displayName: 'Buried cache', stack: 5, durable: false },
  { id: 'oil_lamp', displayName: 'Oil lamp', stack: 5, durable: false },
  { id: 'spikes', displayName: 'Wooden spikes', stack: 10, durable: false },
  { id: 'shelter', displayName: 'Lean-to shelter', stack: 5, durable: false },
  { id: 'wood_door', displayName: 'Wood door', stack: 10, durable: false },
  { id: 'metal_door', displayName: 'Iron door', stack: 10, durable: false },
  { id: 'shutter', displayName: 'Wood shutter', stack: 10, durable: false },
  { id: 'bars', displayName: 'Iron window bars', stack: 10, durable: false },
  { id: 'gateway', displayName: 'Timber gateway', stack: 10, durable: false },
  { id: 'gate', displayName: 'Timber gate', stack: 10, durable: false },
  // CONTENT section 7: "Nine forms x two tiers = 18 inventory pieces ...
  // Stack limit 10." Listed in full like the rest of this catalog; which of
  // them a player can actually craft and place is BUILDING_PIECES' business.
  { id: 'wood_foundation', displayName: 'Wood foundation', stack: 10, durable: false },
  { id: 'wood_steps', displayName: 'Wood steps', stack: 10, durable: false },
  { id: 'wood_pillar', displayName: 'Wood pillar', stack: 10, durable: false },
  { id: 'wood_wall', displayName: 'Wood wall', stack: 10, durable: false },
  { id: 'wood_doorway', displayName: 'Wood doorway', stack: 10, durable: false },
  { id: 'wood_window', displayName: 'Wood window', stack: 10, durable: false },
  { id: 'wood_ceiling', displayName: 'Wood ceiling', stack: 10, durable: false },
  { id: 'wood_stairs', displayName: 'Wood stairs', stack: 10, durable: false },
  { id: 'wood_ramp', displayName: 'Wood ramp', stack: 10, durable: false },
  { id: 'metal_foundation', displayName: 'Iron foundation', stack: 10, durable: false },
  { id: 'metal_steps', displayName: 'Iron steps', stack: 10, durable: false },
  { id: 'metal_pillar', displayName: 'Iron pillar', stack: 10, durable: false },
  { id: 'metal_wall', displayName: 'Iron wall', stack: 10, durable: false },
  { id: 'metal_doorway', displayName: 'Iron doorway', stack: 10, durable: false },
  { id: 'metal_window', displayName: 'Iron window', stack: 10, durable: false },
  { id: 'metal_ceiling', displayName: 'Iron ceiling', stack: 10, durable: false },
  { id: 'metal_stairs', displayName: 'Iron stairs', stack: 10, durable: false },
  { id: 'metal_ramp', displayName: 'Iron ramp', stack: 10, durable: false },
];

export function getItem(id: string): ItemDefinition | undefined {
  return ITEMS.find((item) => item.id === id);
}

/**
 * CONTENT section 10's reject-list, the item-catalog subset: reject if any
 * stack is nonpositive/non-integer or any ID is duplicated.
 */
export function validateItemCatalog(items: ItemDefinition[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) {
      throw new Error(`duplicate item ID: ${item.id}`);
    }
    seen.add(item.id);
    if (!Number.isInteger(item.stack) || item.stack <= 0) {
      throw new Error(`item ${item.id} has a nonpositive or non-integer stack: ${item.stack}`);
    }
  }
}
