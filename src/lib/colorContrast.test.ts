import { describe, expect, it } from 'vitest';
import { readableInkOn } from './colorContrast';

describe('readableInkOn', () => {
  it('puts dark ink on pale soft fills', () => {
    expect(readableInkOn('#FFE4EE')).toBe('#0F0E0D');
    expect(readableInkOn('#FFE1E8')).toBe('#0F0E0D');
    expect(readableInkOn('#E4A2B1')).toBe('#0F0E0D');
  });

  it('puts light ink on dark soft fills', () => {
    expect(readableInkOn('#3A1F2A')).toBe('#FFFFFF');
    expect(readableInkOn('#3B1F28')).toBe('#FFFFFF');
  });
});
