import { useMemo } from 'react';
import { timezoneOptions } from '../lib/time.js';

export default function TimezoneSelect({ id, value, onChange, label, hideLabel = false, className = '' }) {
  const options = useMemo(() => timezoneOptions([value]), [value]);
  return (
    <div className={`tz-select ${className}`}>
      <label htmlFor={id} className={hideLabel ? 'sr-only' : undefined}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((z) => (
          <option key={z.name} value={z.name}>{z.label}</option>
        ))}
      </select>
    </div>
  );
}
