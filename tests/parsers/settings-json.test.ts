import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { parseSettingsJson } from '../../src/parsers/settings-json.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

describe('settings-json parser', () => {
  describe('full-project settings.json', () => {
    const filePath = join(FIXTURES, 'full-project', '.claude', 'settings.json');

    it('returns non-null for valid settings', () => {
      const result = parseSettingsJson(filePath, filePath);
      expect(result).not.toBeNull();
    });

    describe('permissions', () => {
      it('extracts allow list', () => {
        const result = parseSettingsJson(filePath, filePath)!;
        expect(result.permissions.allow).toBeInstanceOf(Array);
        expect(result.permissions.allow).toContain('Bash(npm run *)');
        expect(result.permissions.allow).toContain('Read(src/**)');
        expect(result.permissions.allow).toContain('Write(tests/**)');
      });

      it('extracts deny list', () => {
        const result = parseSettingsJson(filePath, filePath)!;
        expect(result.permissions.deny).toBeInstanceOf(Array);
        expect(result.permissions.deny).toContain('Read(.env)');
        expect(result.permissions.deny).toContain('Bash(rm -rf *)');
        expect(result.permissions.deny).toContain('Bash(git push --force*)');
      });

      it('has correct allow count', () => {
        const result = parseSettingsJson(filePath, filePath)!;
        expect(result.permissions.allow).toHaveLength(8);
      });

      it('has correct deny count', () => {
        const result = parseSettingsJson(filePath, filePath)!;
        expect(result.permissions.deny).toHaveLength(6);
      });
    });

    describe('env', () => {
      it('extracts environment variables', () => {
        const result = parseSettingsJson(filePath, filePath)!;
        expect(result.env).toEqual({
          NODE_ENV: 'development',
          LOG_LEVEL: 'debug',
        });
      });
    });

    describe('sandbox', () => {
      it('extracts sandbox.enabled', () => {
        const result = parseSettingsJson(filePath, filePath)!;
        expect(result.sandbox.enabled).toBe(true);
      });

      it('returns undefined for unset sandbox fields', () => {
        const result = parseSettingsJson(filePath, filePath)!;
        expect(result.sandbox.autoAllowBashIfSandboxed).toBeUndefined();
        expect(result.sandbox.excludedCommands).toBeUndefined();
      });
    });

    describe('hooks', () => {
      it('extracts hook entries', () => {
        const result = parseSettingsJson(filePath, filePath)!;
        expect(result.hooks).toHaveLength(1);
      });

      it('parses hook structure correctly', () => {
        const result = parseSettingsJson(filePath, filePath)!;
        const hook = result.hooks[0];
        expect(hook.event).toBe('PreToolUse');
        expect(hook.matcher).toBe('Bash');
        expect(hook.type).toBe('command');
        expect(hook.command).toBe('./scripts/pre-bash-hook.sh');
        expect(hook.source).toBe(filePath);
      });
    });

    describe('plugins', () => {
      it('returns undefined when no plugins defined', () => {
        const result = parseSettingsJson(filePath, filePath)!;
        expect(result.plugins.enabledPlugins).toBeUndefined();
      });
    });

    describe('model', () => {
      it('returns undefined when model not set', () => {
        const result = parseSettingsJson(filePath, filePath)!;
        expect(result.model).toBeUndefined();
      });
    });

    describe('raw', () => {
      it('preserves the complete raw JSON', () => {
        const result = parseSettingsJson(filePath, filePath)!;
        expect(result.raw).toBeDefined();
        expect(result.raw.permissions).toBeDefined();
        expect(result.raw.sandbox).toBeDefined();
        expect(result.raw.hooks).toBeDefined();
      });
    });
  });

  describe('full-project settings.local.json', () => {
    const filePath = join(FIXTURES, 'full-project', '.claude', 'settings.local.json');

    it('parses partial settings', () => {
      const result = parseSettingsJson(filePath, filePath);
      expect(result).not.toBeNull();
    });

    it('extracts partial allow list', () => {
      const result = parseSettingsJson(filePath, filePath)!;
      expect(result.permissions.allow).toEqual(['Bash(curl *)']);
    });

    it('has empty deny list when not specified', () => {
      const result = parseSettingsJson(filePath, filePath)!;
      expect(result.permissions.deny).toEqual([]);
    });

    it('extracts local env overrides', () => {
      const result = parseSettingsJson(filePath, filePath)!;
      expect(result.env.DATABASE_URL).toBe('postgresql://localhost:5433/acme_dev');
      expect(result.env.LOG_LEVEL).toBe('trace');
    });

    it('has no sandbox when not configured', () => {
      const result = parseSettingsJson(filePath, filePath)!;
      expect(result.sandbox.enabled).toBeUndefined();
    });

    it('has no hooks when not configured', () => {
      const result = parseSettingsJson(filePath, filePath)!;
      expect(result.hooks).toHaveLength(0);
    });
  });

  describe('conflicting settings.json', () => {
    const filePath = join(FIXTURES, 'conflicting', '.claude', 'settings.json');

    it('parses settings with broad permissions', () => {
      const result = parseSettingsJson(filePath, filePath);
      expect(result).not.toBeNull();
    });

    it('has wide-open allow permissions', () => {
      const result = parseSettingsJson(filePath, filePath)!;
      expect(result.permissions.allow).toContain('Read(**)');
      expect(result.permissions.allow).toContain('Write(**)');
    });

    it('has no sandbox configuration', () => {
      const result = parseSettingsJson(filePath, filePath)!;
      expect(result.sandbox.enabled).toBeUndefined();
    });

    it('deny list does not include .env patterns', () => {
      const result = parseSettingsJson(filePath, filePath)!;
      const hasEnvDeny = result.permissions.deny.some((d) => d.includes('.env'));
      expect(hasEnvDeny).toBe(false);
    });

    it('has no hooks', () => {
      const result = parseSettingsJson(filePath, filePath)!;
      expect(result.hooks).toHaveLength(0);
    });

    it('has no model', () => {
      const result = parseSettingsJson(filePath, filePath)!;
      expect(result.model).toBeUndefined();
    });
  });

  describe('overconfigured settings.json', () => {
    const filePath = join(FIXTURES, 'overconfigured', '.claude', 'settings.json');

    it('parses settings with plugins', () => {
      const result = parseSettingsJson(filePath, filePath)!;
      expect(result.plugins.enabledPlugins).toBeDefined();
      expect(result.plugins.enabledPlugins!['code-review@marketplace']).toBe(true);
      expect(result.plugins.enabledPlugins!['auto-format@marketplace']).toBe(false);
    });

    it('extracts network config from sandbox', () => {
      const result = parseSettingsJson(filePath, filePath)!;
      expect(result.sandbox.network).toBeDefined();
      expect(result.sandbox.network!.allowedHosts).toBeInstanceOf(Array);
    });

    it('extracts model', () => {
      const result = parseSettingsJson(filePath, filePath)!;
      expect(result.model).toBe('claude-sonnet-4-20250514');
    });

    it('extracts hooks with command', () => {
      const result = parseSettingsJson(filePath, filePath)!;
      expect(result.hooks).toHaveLength(1);
      expect(result.hooks[0].command).toBe('./scripts/lint-check.sh');
    });

    it('has three env vars', () => {
      const result = parseSettingsJson(filePath, filePath)!;
      expect(Object.keys(result.env)).toHaveLength(3);
      expect(result.env.FEATURE_FLAGS).toBe('true');
    });
  });

  describe('overconfigured settings.local.json', () => {
    const filePath = join(FIXTURES, 'overconfigured', '.claude', 'settings.local.json');

    it('has overlapping permission patterns', () => {
      const result = parseSettingsJson(filePath, filePath)!;
      expect(result.permissions.allow).toContain('Bash(npm run *)');
      expect(result.permissions.deny).toContain('Bash(docker compose *)');
    });

    it('has env overrides', () => {
      const result = parseSettingsJson(filePath, filePath)!;
      expect(result.env.NODE_ENV).toBe('production');
    });

    it('has plugin overrides', () => {
      const result = parseSettingsJson(filePath, filePath)!;
      expect(result.plugins.enabledPlugins!['auto-format@marketplace']).toBe(true);
    });
  });

  describe('error handling', () => {
    it('returns null for non-existent file', () => {
      const result = parseSettingsJson('/nonexistent/settings.json', 'test');
      expect(result).toBeNull();
    });

    it('returns null for malformed JSON', () => {
      const result = parseSettingsJson(
        join(FIXTURES, 'full-project', 'CLAUDE.md'),
        'test',
      );
      expect(result).toBeNull();
    });
  });
});
