import { TestBed } from '@angular/core/testing';
import { TOUCH_HOLD_MS, touchHold } from './touch-hold';

const pointer = (pointerType: string) => ({ pointerType }) as PointerEvent;

describe('touchHold', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const setup = () => {
    const clear = vi.fn();
    const hold = TestBed.runInInjectionContext(() => touchHold(clear));
    return { clear, hold };
  };

  it('clears a mouse readout the moment the pointer leaves', () => {
    const { clear, hold } = setup();
    hold.lift(pointer('mouse'));
    expect(clear).not.toHaveBeenCalled();
    hold.leave(pointer('mouse'));
    expect(clear).toHaveBeenCalledOnce();
  });

  it('keeps a finger readout after the finger lifts, then clears it after a few seconds', () => {
    const { clear, hold } = setup();
    hold.leave(pointer('touch')); // the browser fires leave right after the finger lifts
    hold.lift(pointer('touch'));
    vi.advanceTimersByTime(TOUCH_HOLD_MS - 1);
    expect(clear).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(clear).toHaveBeenCalledOnce();
  });

  it('restarts the wait when the finger touches down again', () => {
    const { clear, hold } = setup();
    hold.lift(pointer('touch'));
    vi.advanceTimersByTime(TOUCH_HOLD_MS - 100);
    hold.keep();
    vi.advanceTimersByTime(TOUCH_HOLD_MS);
    expect(clear).not.toHaveBeenCalled();
  });

  it('clears at once when a gesture is cancelled or the tap lands elsewhere', () => {
    const { clear, hold } = setup();
    hold.lift(pointer('touch'));
    hold.cancel();
    expect(clear).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(TOUCH_HOLD_MS);
    expect(clear).toHaveBeenCalledOnce();
  });
});
