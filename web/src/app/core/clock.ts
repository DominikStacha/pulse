import { Injectable, signal } from '@angular/core';

/** A once-a-second wall clock signal, for "12s ago" labels that keep counting. */
@Injectable({ providedIn: 'root' })
export class Clock {
  readonly now = signal(Date.now());

  constructor() {
    setInterval(() => this.now.set(Date.now()), 1000);
  }
}
