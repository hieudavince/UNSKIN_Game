import { useEffect, useState } from 'react';
import { getSettings, SENSITIVITY_RANGE, setSettings } from '../settings';

function Sliders({ value, onChange }) {
  return (
    <div className="settings-sliders">
      <label className="field">
        <span>Master volume · {Math.round(value.volume * 100)}%</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={value.volume}
          onChange={(e) => onChange({ volume: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        <span>Mouse sensitivity · {value.sensitivity.toFixed(2)}×</span>
        <input
          type="range"
          min={SENSITIVITY_RANGE.min}
          max={SENSITIVITY_RANGE.max}
          step={SENSITIVITY_RANGE.step}
          value={value.sensitivity}
          onChange={(e) => onChange({ sensitivity: Number(e.target.value) })}
        />
      </label>
    </div>
  );
}

// Volume + sensitivity. In the lobby it is a card; in a match a gear button
// (top right, visible while the mouse is free) opens a small popover.
export default function SettingsPanel({ inMatch = false }) {
  const [value, setValue] = useState(getSettings);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const sync = (event) => setValue(event.detail || getSettings());
    window.addEventListener('unskin:settings', sync);
    return () => window.removeEventListener('unskin:settings', sync);
  }, []);
  const change = (patch) => setValue(setSettings(patch));

  if (!inMatch) {
    return (
      <section className="settings panel">
        <header className="brand">
          <span className="logo small">Settings</span>
        </header>
        <Sliders value={value} onChange={change} />
      </section>
    );
  }
  return (
    <div className="settings-float">
      <button className="settings-btn" onClick={() => setOpen((v) => !v)} title="Settings">⚙ Settings</button>
      {open ? (
        <div className="settings-pop panel">
          <Sliders value={value} onChange={change} />
          <button className="primary" onClick={() => setOpen(false)}>Done</button>
        </div>
      ) : null}
    </div>
  );
}
