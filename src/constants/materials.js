// Master list of Skin materials. Add new materials here only —
// every other system (Buy Phase pricing, Skin Gun, Ban/Pick draft)
// should read from this file, not hardcode material names.

export const MATERIAL_TYPES = {
  TITANIUM: 'TITANIUM',
  GLASS:    'GLASS',
  RUBBER:   'RUBBER',
  WOOD:     'WOOD',
  WATER:    'WATER',
  MIRROR:   'MIRROR',
  CONCRETE: 'CONCRETE', // default/neutral material most surfaces start as
};

export const MATERIAL_PROPERTIES = {
  [MATERIAL_TYPES.TITANIUM]: {
    label: 'Titanium', bulletPenetrable: false, transparent: false,
    walkable: true, special: null, creditCost: 400,
  },
  [MATERIAL_TYPES.GLASS]: {
    label: 'Glass', bulletPenetrable: true, transparent: true,
    walkable: true, special: null, creditCost: 250,
  },
  [MATERIAL_TYPES.RUBBER]: {
    label: 'Rubber', bulletPenetrable: false, transparent: false,
    walkable: true, special: 'BOUNCE', creditCost: 200,
  },
  [MATERIAL_TYPES.WOOD]: {
    label: 'Wood', bulletPenetrable: true, transparent: false,
    walkable: true, special: null, creditCost: 100,
  },
  [MATERIAL_TYPES.WATER]: {
    label: 'Water', bulletPenetrable: true, transparent: true,
    walkable: false, special: 'SLOW', creditCost: 300,
  },
  [MATERIAL_TYPES.MIRROR]: {
    label: 'Mirror', bulletPenetrable: false, transparent: false,
    walkable: true, special: 'RICOCHET', creditCost: 450,
  },
  [MATERIAL_TYPES.CONCRETE]: {
    label: 'Concrete', bulletPenetrable: false, transparent: false,
    walkable: true, special: null, creditCost: 0, // default, not purchasable
  },
};

// "Wireframe Void" = state of a surface after Unskin (left-click),
// before Reskin (right-click). Objects/players pass through it.
export const WIREFRAME_VOID = 'WIREFRAME_VOID';
