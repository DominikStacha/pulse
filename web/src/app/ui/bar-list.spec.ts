import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Row } from '../core/api';
import { BarList } from './bar-list';

const rows: Row[] = [
  { key: 'CZ', label: 'Czechia', visitors: 200, count: 400, share: 0.5 },
  { key: 'DE', label: 'Germany', visitors: 100, count: 150, share: 0.25 },
  { key: null, label: 'Direct', visitors: 50, count: 60, share: 0.125 },
];

function render(options: { icon?: 'flag' | 'none'; metric?: 'visitors' | 'count' } = {}) {
  TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
  const fixture = TestBed.createComponent(BarList);
  fixture.componentRef.setInput('rows', rows);
  if (options.icon) fixture.componentRef.setInput('icon', options.icon);
  if (options.metric) fixture.componentRef.setInput('metric', options.metric);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('BarList', () => {
  it('shows label, value and share for each row', () => {
    const items = [...render().querySelectorAll('li')];
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('Czechia');
    expect(items[0].textContent).toContain('200');
    expect(items[0].textContent).toContain('50%');
    expect(items[2].textContent).toContain('Direct');
  });

  it('scales every bar against the biggest row', () => {
    const bars = [...render().querySelectorAll<HTMLElement>('.bar')].map((b) => b.style.transform);
    expect(bars[0]).toContain('0.96');
    expect(bars[1]).toContain('0.48');
  });

  it('draws flags for country lists and falls back to a globe when there is no code', () => {
    const text = render({ icon: 'flag' }).textContent ?? '';
    expect(text).toContain('🇨🇿');
    expect(text).toContain('🌐');
  });

  it('ranks by event count when asked to', () => {
    const items = [...render({ metric: 'count' }).querySelectorAll('li')];
    expect(items[0].textContent).toContain('400');
  });
});
