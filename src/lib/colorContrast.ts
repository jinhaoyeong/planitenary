/**
 * Pick black or white ink for text sitting on a solid hex fill.
 * Soft panels and accent buttons both need this — shell ink is for page bg,
 * not for whatever pastel or punch colour landed in the fill token.
 */
export function readableInkOn(hex: string): string {
  const value = hex.replace('#', '');
  if (value.length !== 6) return '#0F0E0D';
  const channels = [0, 2, 4].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  return luminance > 0.45 ? '#0F0E0D' : '#FFFFFF';
}
