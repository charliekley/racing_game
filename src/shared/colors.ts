/** Kart colors players can choose. The index into this array is what goes over the network. */
export const KART_COLORS = [
  { name: 'Red', hex: '#e63946' },
  { name: 'Blue', hex: '#3a86ff' },
  { name: 'Green', hex: '#2bb673' },
  { name: 'Yellow', hex: '#ffbe0b' },
  { name: 'Purple', hex: '#8338ec' },
  { name: 'Orange', hex: '#fb5607' },
  { name: 'Pink', hex: '#ff4fa3' },
  { name: 'Teal', hex: '#14b8b8' },
] as const;

export function colorHex(index: number): string {
  const n = KART_COLORS.length;
  return KART_COLORS[((index % n) + n) % n].hex;
}

export function clampColorIndex(index: unknown): number {
  const n = typeof index === 'number' && Number.isInteger(index) ? index : 0;
  return Math.max(0, Math.min(KART_COLORS.length - 1, n));
}
