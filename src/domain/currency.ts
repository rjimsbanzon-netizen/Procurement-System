export function formatPeso(amount: unknown): string {
  const value = Number(amount || 0);
  return `₱${value.toLocaleString('en-PH', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}`;
}

export function formatCompactPeso(amount: unknown): string {
  const value = Number(amount || 0);
  const absoluteValue = Math.abs(value);
  const units = [
    { threshold: 1_000_000_000, suffix: 'B' },
    { threshold: 1_000_000, suffix: 'M' },
    { threshold: 1_000, suffix: 'K' }
  ];
  const unit = units.find(candidate => absoluteValue >= candidate.threshold);
  if (!unit) return `₱${value.toLocaleString('en-PH', { maximumFractionDigits: 2 })}`;

  const unitIndex = units.indexOf(unit);
  const decimals = Math.abs(value / unit.threshold) < 100 ? 1 : 0;
  const scaled = value / unit.threshold;
  const roundedScaled = Number(scaled.toFixed(decimals));
  const displayUnit = Math.abs(roundedScaled) >= 1_000 && units[unitIndex - 1]
    ? units[unitIndex - 1]
    : unit;
  const displayValue = value / displayUnit.threshold;
  return `₱${displayValue.toLocaleString('en-PH', {
    maximumFractionDigits: displayUnit === unit && Math.abs(displayValue) < 100 ? 1 : 0
  })}${displayUnit.suffix}`;
}
