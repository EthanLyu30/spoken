/** Keep missing measurements distinct from zero and tiny positive charges. */
export function referenceCost(min: number | null | undefined, max: number | null | undefined): string {
  if (min == null || max == null || !Number.isFinite(min) || !Number.isFinite(max)) return '—';
  const amount = (value: number) => value > 0 && value < .0001 ? '<0.0001' : value === 0 ? '0' : value.toFixed(4);
  const a = amount(min), b = amount(max);
  return `¥${a === b ? a : `${a}–${b}`}`;
}
