export function satur(value: number, plateau: number): number {
  if (!Number.isFinite(value)) {
    throw new Error("Saturation input value must be finite.");
  }
  if (!Number.isFinite(plateau) || plateau <= 0.0) {
    throw new Error("Saturation plateau must be positive and finite.");
  }
  if (value <= 0.0) {
    return 0.0;
  }
  if (value >= plateau) {
    return plateau;
  }

  const normalizedValue = value / plateau;
  return plateau * smoothstep(normalizedValue);
}

export function smoothstep(value: number): number {
  return value * value * (3.0 - 2.0 * value);
}