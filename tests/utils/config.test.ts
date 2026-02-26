import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { loadConfig, toLintConfig } from '../../src/utils/config.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

describe('config loader', () => {
  // Save original HOME
  const originalHome = process.env.HOME;

  beforeEach(() => {
    // Point HOME to a directory without .ccinspect.json to avoid interference
    process.env.HOME = join(FIXTURES, 'minimal-project');
  });

  afterEach(() => {
    process.env.HOME = originalHome;
  });

  describe('loadConfig', () => {
    it('returns empty rules when no config files exist', () => {
      const config = loadConfig(join(FIXTURES, 'minimal-project'));
      expect(config.rules).toBeDefined();
      expect(Object.keys(config.rules)).toHaveLength(0);
    });

    it('loads project .ccinspect.json', () => {
      const config = loadConfig(join(FIXTURES, 'conflicting'));
      expect(Object.keys(config.rules).length).toBeGreaterThan(0);
    });

    it('normalizes boolean true to enabled', () => {
      const config = loadConfig(join(FIXTURES, 'conflicting'));
      // settings/sandbox-recommended is set to false
      expect(config.rules['settings/sandbox-recommended']).toBeDefined();
      expect(config.rules['settings/sandbox-recommended'].enabled).toBe(false);
    });

    it('normalizes object config with thresholds', () => {
      const config = loadConfig(join(FIXTURES, 'conflicting'));
      const lineCount = config.rules['memory/line-count'];
      expect(lineCount).toBeDefined();
      expect(lineCount.enabled).toBe(true); // not explicitly false, defaults true
      expect(lineCount.warn).toBe(100);
      expect(lineCount.error).toBe(250);
    });
  });

  describe('toLintConfig', () => {
    it('converts disabled rules to false', () => {
      const ccinspectConfig = {
        rules: {
          'settings/sandbox-recommended': { enabled: false },
        },
      };
      const lintConfig = toLintConfig(ccinspectConfig);
      expect(lintConfig.rules['settings/sandbox-recommended']).toBe(false);
    });

    it('converts enabled rules with options to object', () => {
      const ccinspectConfig = {
        rules: {
          'memory/line-count': { enabled: true, warn: 100, error: 250 },
        },
      };
      const lintConfig = toLintConfig(ccinspectConfig);
      const rule = lintConfig.rules['memory/line-count'];
      expect(typeof rule).toBe('object');
      expect((rule as Record<string, unknown>).warn).toBe(100);
      expect((rule as Record<string, unknown>).error).toBe(250);
    });

    it('converts enabled rules without options to true', () => {
      const ccinspectConfig = {
        rules: {
          'memory/generic-instructions': { enabled: true },
        },
      };
      const lintConfig = toLintConfig(ccinspectConfig);
      expect(lintConfig.rules['memory/generic-instructions']).toBe(true);
    });
  });
});
