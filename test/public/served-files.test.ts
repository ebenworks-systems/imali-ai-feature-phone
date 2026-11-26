import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// public/ is the folder Vercel serves (vercel.json outputDirectory) and the Node app serves it too. Every file in it
// is published at the live address, so the folder holds the page and nothing else. Tests live in test/public/.
const publicDir = new URL('../../public/', import.meta.url);

// The page's own files. Add a file here only when the page needs it.
const PAGE_FILES = [
  'api.js',
  'fraunces.woff2',
  'geist-mono.woff2',
  'geist.woff2',
  'index.html',
  'ledger-logic.js',
  'ledger.js',
  'phone-logic.js',
  'phone.js',
  'styles.css',
  'vt323.woff2'
];

function listFiles(): string[] {
  // Paths relative to public/, with / as the separator. recursive: true also returns folders, so drop those.
  return readdirSync(publicDir, { recursive: true, encoding: 'utf8' })
    .map((path) => path.replace(/\\/g, '/'))
    .filter((path) => !statSync(new URL(path, publicDir)).isDirectory())
    .sort();
}

describe('public/ holds only the files the page serves', () => {
  it('has no test files (*.test.ts, *.spec.ts and their .js and .tsx forms)', () => {
    const tests = listFiles().filter((file) => /\.(test|spec)\.[cm]?[jt]sx?$/i.test(file));
    expect(tests, 'move these to test/public/').toEqual([]);
  });

  it('has no source maps (*.map)', () => {
    const maps = listFiles().filter((file) => /\.map$/i.test(file));
    expect(maps).toEqual([]);
  });

  it('has no file outside the page list, and no folder of files', () => {
    expect(listFiles()).toEqual(PAGE_FILES);
  });

  it('has every file index.html and the page modules load', () => {
    const files = listFiles();
    const html = readFileSync(new URL('index.html', publicDir), 'utf8');
    const local = [...html.matchAll(/(?:src|href)="([^"#:]+\.(?:js|css))"/g)].map((match) => match[1]!);
    expect(local.length).toBeGreaterThan(0);
    for (const file of local) expect(files, `index.html loads ${file}`).toContain(file);
    for (const name of files.filter((file) => file.endsWith('.js'))) {
      const source = readFileSync(new URL(name, publicDir), 'utf8');
      for (const match of source.matchAll(/from '\.\/([^']+)'/g)) {
        expect(files, `${name} imports ${match[1]}`).toContain(match[1]);
      }
    }
  });

  it('loads nothing from another host: fonts and styles come from this folder', () => {
    const files = listFiles();
    const html = readFileSync(new URL('index.html', publicDir), 'utf8');
    const css = readFileSync(new URL('styles.css', publicDir), 'utf8');
    // Links a visitor clicks (<a href>) may go anywhere; what the page itself loads (<link>, <script>, <img>) may not.
    expect(html, 'index.html loads from an outside address').not.toMatch(/<(?:link|script|img)\b[^>]*(?:src|href)="https?:/i);
    expect(html).not.toMatch(/fonts\.googleapis|fonts\.gstatic/i);
    const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("style-src 'self';");
    const urls = [...css.matchAll(/url\(\s*'([^']+)'\s*\)/g)].map((match) => match[1]!);
    expect(urls.length).toBeGreaterThan(0);
    for (const url of urls) {
      expect(url, 'styles.css loads from another host').not.toMatch(/^[a-z]+:/i);
      expect(files, `styles.css loads ${url}`).toContain(url);
    }
  });
});
