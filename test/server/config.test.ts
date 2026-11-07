import { describe, expect, it } from 'vitest';
import { ConfigError, readConfig, readPort } from '../../src/server/config.js';

describe('readConfig', () => {
  it('gives an empty config for an empty environment', () => {
    expect(readConfig({})).toEqual({ onVercel: false, warnings: [] });
  });

  it('counts an unset, empty or only-spaces value as not set', () => {
    const config = readConfig({
      DATABASE_URL: '',
      GEMINI_API_KEY: '   ',
      GEMINI_MODEL: '\t',
      AT_USERNAME: ' ',
      AT_API_KEY: '',
      AT_SHORTCODE: '  ',
      AT_CALLBACK_KEY: '   ',
      VERCEL: ''
    });
    expect(config).toEqual({ onVercel: false, warnings: [] });
  });

  it('reads the database url and the Gemini variables, trimmed', () => {
    const config = readConfig({ DATABASE_URL: ' db-url ', GEMINI_API_KEY: ' gk ', GEMINI_MODEL: ' gemini-x ' });
    expect(config.databaseUrl).toBe('db-url');
    expect(config.geminiApiKey).toBe('gk');
    expect(config.geminiModel).toBe('gemini-x');
  });

  it('gives the sender settings when both AT variables are set, with the sandbox short code 46254', () => {
    const config = readConfig({ AT_USERNAME: 'sandbox', AT_API_KEY: 'k' });
    expect(config.at).toEqual({ username: 'sandbox', apiKey: 'k', shortcode: '46254' });
    expect(config.warnings).toEqual([]);
  });

  it('lets AT_SHORTCODE override the short code', () => {
    expect(readConfig({ AT_USERNAME: 'u', AT_API_KEY: 'k', AT_SHORTCODE: '12345' }).at?.shortcode).toBe('12345');
  });

  it('gives no sender and a warning that names the missing variable when only one AT variable is set', () => {
    const noKey = readConfig({ AT_USERNAME: 'secret-user-name' });
    expect(noKey.at).toBeUndefined();
    expect(noKey.warnings).toHaveLength(1);
    expect(noKey.warnings[0]).toContain('AT_API_KEY');
    expect(noKey.warnings[0]).not.toContain('secret-user-name');

    const noUser = readConfig({ AT_API_KEY: 'secret-key-value' });
    expect(noUser.at).toBeUndefined();
    expect(noUser.warnings[0]).toContain('AT_USERNAME');
    expect(noUser.warnings[0]).not.toContain('secret-key-value');
  });

  it('reads the callback key, trimmed', () => {
    expect(readConfig({ AT_CALLBACK_KEY: ' abc ' }).callbackKey).toBe('abc');
  });

  it('warns that records are not kept when VERCEL is set without DATABASE_URL', () => {
    const config = readConfig({ VERCEL: '1' });
    expect(config.onVercel).toBe(true);
    expect(config.warnings.join(' ')).toMatch(/DATABASE_URL is not set/);
    expect(readConfig({ VERCEL: '1', DATABASE_URL: 'x' }).warnings).toEqual([]);
  });

  it('never puts a value in a warning', () => {
    const config = readConfig({ VERCEL: '1', AT_USERNAME: 'u-value', GEMINI_API_KEY: 'g-value', AT_CALLBACK_KEY: 'c-value' });
    for (const w of config.warnings) {
      for (const value of ['u-value', 'g-value', 'c-value']) expect(w).not.toContain(value);
    }
  });
});

describe('readPort', () => {
  it('defaults to 3000', () => {
    expect(readPort({})).toBe(3000);
    expect(readPort({ PORT: '' })).toBe(3000);
    expect(readPort({ PORT: '  ' })).toBe(3000);
  });

  it.each([
    ['3000', 3000],
    ['3077', 3077],
    ['1', 1],
    ['65535', 65535],
    [' 8080 ', 8080]
  ])('accepts %j', (raw, expected) => {
    expect(readPort({ PORT: raw })).toBe(expected);
  });

  it.each(['0', '70000', '65536', 'abc', '3000.5', '-1', '1e3', '0x50', '3000abc'])(
    'refuses %j with a ConfigError that names PORT',
    (raw) => {
      expect(() => readPort({ PORT: raw })).toThrow(ConfigError);
      expect(() => readPort({ PORT: raw })).toThrow(/PORT/);
    }
  );
});
