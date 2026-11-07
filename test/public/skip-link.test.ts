import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The design rule is a light theme with no dark filled area of any size. The skip link is hidden until it gets
// keyboard focus; when it shows, it must be the light core fill with ink text and the focus ring.
const css = readFileSync(new URL('../../public/styles.css', import.meta.url), 'utf8');

/** The declarations of the first rule whose selector is exactly `selector`. */
function rule(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.:]/g, '\\$&');
  const match = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(css);
  expect(match, `a rule for ${selector}`).not.toBeNull();
  const declarations: Record<string, string> = {};
  for (const line of match![1]!.split(';')) {
    const [name, ...value] = line.split(':');
    if (name && value.length > 0) declarations[name.trim()] = value.join(':').trim();
  }
  return declarations;
}

/** The value of a custom property in :root, following `var(--other)` references. */
function token(name: string): string {
  const match = new RegExp(`${name}:\\s*([^;]+);`).exec(css);
  expect(match, `the token ${name}`).not.toBeNull();
  const value = match![1]!.replace(/\/\*.*?\*\//g, '').trim();
  const reference = /^var\((--[a-z-]+)\)$/.exec(value);
  return reference ? token(reference[1]!) : value;
}

function resolve(value: string): string {
  const reference = /^var\((--[a-z-]+)\)$/.exec(value.trim());
  expect(reference, `${value} should be a var(--token)`).not.toBeNull();
  return token(reference![1]!);
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('the skip link (a.skip)', () => {
  it('is filled with the light core fill, never --ink', () => {
    const skip = rule('.skip');
    expect(skip.background).toBe('var(--core)');
    expect(skip.background).not.toContain('--ink');
    expect(token('--core')).toBe('#FFFDF8');
  });

  it('has --ink text at 4.5:1 or better against its fill', () => {
    const skip = rule('.skip');
    expect(skip.color).toBe('var(--ink)');
    expect(contrast(resolve(skip.color!), resolve(skip.background!))).toBeGreaterThanOrEqual(4.5);
  });

  it('shows the --focus ring on focus, at 4.5:1 or better against the page', () => {
    const focus = rule('.skip:focus');
    expect(focus.transform).toBe('none');
    expect(focus.outline).toBe('2px solid var(--focus)');
    expect(contrast(resolve('var(--focus)'), resolve('var(--paper)'))).toBeGreaterThanOrEqual(4.5);
  });

  it('leaves no dark token for it to use: --on-ink is gone', () => {
    expect(css).not.toContain('--on-ink');
  });
});
