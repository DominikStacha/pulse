import { DestroyRef, ElementRef, Signal, afterNextRender, inject, signal } from '@angular/core';

/**
 * Width of the host element in CSS pixels, kept current by a ResizeObserver.
 * Charts draw in real pixels so text and strokes are never scaled. Call in an
 * injection context; the host needs `display: block`.
 */
export function hostWidth(): Signal<number> {
  const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  const destroyRef = inject(DestroyRef);
  const width = signal(0);
  afterNextRender(() => {
    width.set(Math.round(el.getBoundingClientRect().width));
    const observer = new ResizeObserver(([entry]) =>
      width.set(Math.round(entry.contentRect.width)),
    );
    observer.observe(el);
    destroyRef.onDestroy(() => observer.disconnect());
  });
  return width;
}

/** True when the visitor asked for less motion. Read at the moment of animating. */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
