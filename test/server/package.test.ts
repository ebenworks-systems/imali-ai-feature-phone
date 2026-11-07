import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const root = new URL('../../', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as {
  name: string;
  private?: boolean;
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  main?: string;
  types?: string;
};

describe('package.json and .gitignore (requirements 6 and 96)', () => {
  it('is named imali-ai-feature-phone and is private', () => {
    expect(pkg.name).toBe('imali-ai-feature-phone');
    expect(pkg.private).toBe(true);
  });

  it('asks for Node 22 so Vercel runs Node 22', () => {
    expect(pkg.engines).toEqual({ node: '22.x' });
  });

  it('has exactly three dependencies, with hono on the 4.x line', () => {
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual(['@hono/node-server', 'hono', 'postgres']);
    expect(pkg.dependencies?.hono).toMatch(/^[\^~]4\.\d+\.\d+$/);
  });

  it('points main and types at the build output under dist/src', () => {
    expect(pkg.main).toBe('./dist/src/index.js');
    expect(pkg.types).toBe('./dist/src/index.d.ts');
  });

  it('ignores the .vercel folder', () => {
    const lines = readFileSync(new URL('.gitignore', root), 'utf8').split('\n').map((l) => l.trim());
    expect(lines).toContain('.vercel');
  });

  it('lists every environment variable in .env.example with an empty value', () => {
    const lines = readFileSync(new URL('.env.example', root), 'utf8').split('\n').filter((l) => l.trim() !== '');
    expect(lines).toEqual([
      'DATABASE_URL=',
      'GEMINI_API_KEY=',
      'GEMINI_MODEL=',
      'AT_USERNAME=',
      'AT_API_KEY=',
      'AT_SHORTCODE=',
      'AT_CALLBACK_KEY=',
      'PORT=',
      'TEST_DATABASE_URL='
    ]);
  });
});
