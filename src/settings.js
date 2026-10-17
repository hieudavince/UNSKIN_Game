// Player settings kept in localStorage: master volume and mouse sensitivity.
// Changes are broadcast with a window event so a running match picks them up.
const KEY = 'unskinSettings';
export const DEFAULT_SETTINGS = { volume: 0.8, sensitivity: 1 };
export const SENSITIVITY_RANGE = { min: 0.2, max: 3, step: 0.05 };

const clamp = (v, lo, hi, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

export function getSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return {
      volume: clamp(raw.volume, 0, 1, DEFAULT_SETTINGS.volume),
      sensitivity: clamp(raw.sensitivity, SENSITIVITY_RANGE.min, SENSITIVITY_RANGE.max, DEFAULT_SETTINGS.sensitivity),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  next.volume = clamp(next.volume, 0, 1, DEFAULT_SETTINGS.volume);
  next.sensitivity = clamp(next.sensitivity, SENSITIVITY_RANGE.min, SENSITIVITY_RANGE.max, DEFAULT_SETTINGS.sensitivity);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage may be unavailable (private mode); settings still apply this session
  }
  window.dispatchEvent(new CustomEvent('unskin:settings', { detail: next }));
  return next;
}
