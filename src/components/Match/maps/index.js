import { labMap, LAB_ID } from './labMap';
import { complexMap, COMPLEX_ID } from './complexMap';

const BUILDERS = { [LAB_ID]: labMap, [COMPLEX_ID]: complexMap };
const cache = new Map();

export const MAP_IDS = { LAB: LAB_ID, COMPLEX: COMPLEX_ID };

export function mapSpec(id) {
  const key = BUILDERS[id] ? id : LAB_ID;
  if (!cache.has(key)) cache.set(key, BUILDERS[key]());
  return cache.get(key);
}
