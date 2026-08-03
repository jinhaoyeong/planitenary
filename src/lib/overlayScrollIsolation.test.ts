import { describe, expect, it, vi } from 'vitest';
import { handleNestedListWheel } from './overlayScrollIsolation';

describe('handleNestedListWheel', () => {
  it('scrolls the list instead of letting the event bubble', () => {
    const list = { scrollHeight: 400, clientHeight: 200, scrollTop: 0 };

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    handleNestedListWheel({
      currentTarget: list,
      deltaY: 40,
      preventDefault,
      stopPropagation,
    } as unknown as React.WheelEvent<HTMLElement>);

    expect(list.scrollTop).toBe(40);
    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
  });
});
