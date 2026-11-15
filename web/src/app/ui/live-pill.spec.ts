import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { LIVE_STREAM, LiveService, LiveStream } from '../core/live';
import { LivePill } from './live-pill';

describe('LivePill', () => {
  async function setup() {
    const handlers: Record<string, (e: Event) => void> = {};
    const stream: LiveStream = {
      readyState: 0,
      addEventListener: (type, listener) => void (handlers[type] = listener),
      close: () => {},
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: LIVE_STREAM, useValue: () => stream },
      ],
    });
    const http = TestBed.inject(HttpTestingController);
    TestBed.inject(LiveService).start();
    const fixture = TestBed.createComponent(LivePill);
    const el = fixture.nativeElement as HTMLElement;
    const settle = () => {
      fixture.detectChanges();
      TestBed.tick();
      return {
        text: el.textContent?.replace(/\s+/g, ' ').trim(),
        label: el.querySelector('a')?.getAttribute('aria-label'),
        title: el.querySelector('a')?.getAttribute('title'),
      };
    };
    return { http, handlers, settle };
  }

  it('says what the live stream is doing, in the same box every time', async () => {
    const { http, handlers, settle } = await setup();
    expect(settle().text).toBe('Reconnecting…');

    handlers['open'](new Event('open'));
    expect(settle().text).toBe('Live');

    http.expectOne('/api/live').flush({ activeVisitors: 7, perSite: [], recent: [] });
    expect(settle().label).toBe('7 visitors online now. Open live view.');

    // The stream drops: the last count stays and the tooltip says why.
    handlers['error'](new Event('error'));
    expect(settle().label).toBe('7 visitors online now. Open live view.');
    expect(settle().title).toBe('The live stream is reconnecting');
  });
});
