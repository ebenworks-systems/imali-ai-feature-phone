import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The menu must take its time from `now`, make no network call, never import a database driver, and add no
 * dependency. These checks read the source of every file under `src/channels/ussd/`.
 */

const ROOT = join(import.meta.dirname, '..', '..', '..');
const USSD_DIR = join(ROOT, 'src', 'channels', 'ussd');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};
const KNOWN_PACKAGES = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.devDependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {})
]);

/** Node modules that reach the network. */
const NETWORK_MODULES = new Set(['http', 'https', 'http2', 'net', 'tls', 'dgram', 'dns']);

/** Comments are not code: they may say "never call Date.now". */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

function importedModules(code: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\bimport\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:[\w*{}\s,]+\s+)?from\s+['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) found.push(match[1]!);
  }
  return found;
}

function packageName(specifier: string): string {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0]!;
}

/** What is wrong with a source file. An empty list means it follows the rules. */
export function violations(source: string, known: ReadonlySet<string> = KNOWN_PACKAGES): string[] {
  const code = stripComments(source);
  const problems: string[] = [];
  if (/new\s+Date\s*\(\s*\)/.test(code)) problems.push('new Date() with no argument');
  if (/\bDate\s*\.\s*now\b/.test(code)) problems.push('Date.now');
  if (/\bfetch\s*\(/.test(code)) problems.push('fetch(');
  if (/\bprocess\s*\.\s*env\b/.test(code)) problems.push('process.env');
  if (/\bXMLHttpRequest\b|\bWebSocket\b/.test(code)) problems.push('a network client');

  for (const specifier of importedModules(code)) {
    if (specifier.startsWith('.')) continue;
    const bare = specifier.startsWith('node:') ? specifier.slice(5) : specifier;
    const name = packageName(bare);
    if (name === 'postgres' || name === 'pg') {
      problems.push(`import of ${specifier}`);
    } else if (NETWORK_MODULES.has(name)) {
      problems.push(`import of ${specifier} (network)`);
    } else if (specifier.startsWith('node:')) {
      continue; // a Node.js built-in, not a package
    } else if (!known.has(name)) {
      problems.push(`import of ${specifier}, which is not in package.json`);
    }
  }
  return problems;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith('.ts') ? [path] : [];
  });
}

describe('the real files under src/channels/ussd', () => {
  const files = sourceFiles(USSD_DIR);

  it('finds the files', () => {
    expect(files.length).toBeGreaterThanOrEqual(13);
    expect(files.some((f) => f.endsWith('handler.ts'))).toBe(true);
  });

  for (const file of files) {
    it(`${file.slice(ROOT.length + 1)} follows the rules`, () => {
      expect(violations(readFileSync(file, 'utf8'))).toEqual([]);
    });
  }
});

describe('the rule check itself', () => {
  it('passes clean code', () => {
    const clean = `import { x } from '../../core/index.js';\nimport { readFileSync } from 'node:fs';\nconst d = new Date(now);\nconst t = new Date(0);`;
    expect(violations(clean)).toEqual([]);
  });

  it('fails new Date() with no argument, but not with one', () => {
    expect(violations('const d = new Date();')).toEqual(['new Date() with no argument']);
    expect(violations('const d = new Date( );')).toEqual(['new Date() with no argument']);
    expect(violations('const d = new Date(now.getTime());')).toEqual([]);
  });

  it('fails Date.now', () => {
    expect(violations('const t = Date.now();')).toEqual(['Date.now']);
    expect(violations('const t = Date . now();')).toEqual(['Date.now']);
  });

  it('fails fetch(', () => {
    expect(violations("await fetch('https://example.invalid');")).toEqual(['fetch(']);
    expect(violations('await fetch (url)')).toEqual(['fetch(']);
  });

  it('fails process.env', () => {
    expect(violations('const k = process.env.KEY;')).toEqual(['process.env']);
  });

  it('fails an import of postgres', () => {
    expect(violations("import postgres from 'postgres';")).toEqual(['import of postgres']);
    expect(violations("import { Pool } from 'pg';")).toEqual(['import of pg']);
    expect(violations("const sql = await import('postgres');")).toEqual(['import of postgres']);
  });

  it('fails an import from a package that is not in package.json', () => {
    expect(violations("import _ from 'lodash';")).toEqual(['import of lodash, which is not in package.json']);
    expect(violations("import x from '@scope/thing/deep';")).toEqual([
      'import of @scope/thing/deep, which is not in package.json'
    ]);
    expect(violations("export { y } from 'left-pad';")).toEqual(['import of left-pad, which is not in package.json']);
    expect(violations("const z = require('chalk');")).toEqual(['import of chalk, which is not in package.json']);
  });

  it('allows a package that is in package.json', () => {
    expect(violations("import { it } from 'vitest';")).toEqual([]);
    expect(violations("import { it } from 'vitest';", new Set())).toEqual([
      'import of vitest, which is not in package.json'
    ]);
  });

  it('fails a network module from Node.js', () => {
    expect(violations("import https from 'node:https';")).toEqual(['import of node:https (network)']);
    expect(violations("import net from 'net';")).toEqual(['import of net (network)']);
  });

  it('allows relative imports and Node.js built-ins that are not the network', () => {
    expect(violations("import { a } from './a.js';\nimport { b } from '../b.js';\nimport { c } from 'node:path';")).toEqual([]);
  });

  it('ignores the banned words in comments', () => {
    expect(violations('// never call Date.now() or fetch(url) or new Date()\n/* process.env */\nconst a = 1;')).toEqual([]);
    expect(violations('/**\n * The clock is never read: no Date.now, no new Date().\n */\nexport const a = 1;')).toEqual([]);
  });

  it('reports every problem in a file', () => {
    expect(violations("import postgres from 'postgres';\nconst t = Date.now();\nfetch(u);").sort()).toEqual(
      ['Date.now', 'fetch(', 'import of postgres'].sort()
    );
  });
});
