import { DestroyRef, inject } from '@angular/core';

/** How long a finger's readout lingers after the finger lifts. */
export const TOUCH_HOLD_MS = 3000;

/**
 * Hover readouts for fingers. A mouse readout follows the pointer and goes when it leaves; a
 * finger lets go of the screen, so its readout has to stay (clear it on a tap elsewhere, a
 * cancelled gesture such as a scroll, or after a few seconds). Call in an injection context.
 */
export function touchHold(clear: () => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  return {
    /** A pointer is down or moving over the readout's surface: keep it. */
    keep(): void {
      clearTimeout(timer);
    },
    /** The pointer lifted: a finger's readout lingers, a mouse's stays until it leaves. */
    lift(event: PointerEvent): void {
      if (event.pointerType === 'mouse') return;
      clearTimeout(timer);
      timer = setTimeout(clear, TOUCH_HOLD_MS);
    },
    /** The pointer left the surface: only a mouse clears at once. */
    leave(event: PointerEvent): void {
      if (event.pointerType === 'mouse') clear();
    },
    /** A gesture was taken over (scroll) or the tap landed elsewhere. */
    cancel(): void {
      clearTimeout(timer);
      clear();
    },
  };
}
