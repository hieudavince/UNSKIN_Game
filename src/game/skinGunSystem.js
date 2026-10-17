// Pure data/logic for the Skin Gun mechanic — no rendering. Whatever engine
// renders the 3D scene (Three.js canvas, or an embedded Unity/Unreal build)
// calls into this to decide what a shot should do, and reports back through
// firebase/matchService.reportSkinEvent so it's synced to teammates.

import { MATERIAL_PROPERTIES, WIREFRAME_VOID } from '../constants/materials';

/**
 * Left-click: Unskin. Peels the surface off an object, storing the material
 * in the shooter's inventory and leaving a Wireframe Void.
 */
export function unskin(surface, inventory) {
  if (surface.currentMaterial === WIREFRAME_VOID) {
    return { error: 'Surface already has no material to peel.' };
  }
  const material = surface.currentMaterial;
  return {
    updatedSurface: { ...surface, currentMaterial: WIREFRAME_VOID },
    updatedInventory: {
      ...inventory,
      [material]: (inventory[material] ?? 0) + 1,
    },
  };
}

/**
 * Right-click: Reskin. Applies a stored (or purchased) material onto a
 * surface, overwriting whatever was there — including a Wireframe Void.
 */
export function reskin(surface, inventory, materialType) {
  const owned = inventory[materialType] ?? 0;
  if (owned <= 0) {
    return { error: `No ${materialType} cartridges in inventory.` };
  }
  return {
    updatedSurface: { ...surface, currentMaterial: materialType },
    updatedInventory: { ...inventory, [materialType]: owned - 1 },
  };
}

/** Whether a bullet fired at this surface should pass through, deflect, or stop. */
export function resolveBulletInteraction(surface) {
  if (surface.currentMaterial === WIREFRAME_VOID) return 'PASS_THROUGH';
  const props = MATERIAL_PROPERTIES[surface.currentMaterial];
  if (!props) return 'STOP';
  if (props.special === 'RICOCHET') return 'RICOCHET';
  return props.bulletPenetrable ? 'PASS_THROUGH_SLOWED' : 'STOP';
}

/** Whether line-of-sight passes through this surface (e.g. Glass). */
export function isTransparent(surface) {
  if (surface.currentMaterial === WIREFRAME_VOID) return true;
  return MATERIAL_PROPERTIES[surface.currentMaterial]?.transparent ?? false;
}

/** Whether a player standing on/against this surface falls/passes through
 * (Wireframe Void floors) or is affected by a special (Rubber bounce, Water slow). */
export function resolvePlayerInteraction(surface) {
  if (surface.currentMaterial === WIREFRAME_VOID) return 'FALL_THROUGH';
  const props = MATERIAL_PROPERTIES[surface.currentMaterial];
  if (props?.special === 'BOUNCE') return 'BOUNCE';
  if (props?.special === 'SLOW') return 'SLOWED';
  return 'NORMAL';
}
