import { describe, it, expect } from 'vitest';
import { classifyConfigFile, inferScope, getExpectedFilenames } from '../../src/utils/file-classifier.js';

describe('classifyConfigFile', () => {
  describe('claude-md', () => {
    it('classifies CLAUDE.md', () => {
      expect(classifyConfigFile('CLAUDE.md')).toBe('claude-md');
    });

    it('classifies CLAUDE.local.md', () => {
      expect(classifyConfigFile('CLAUDE.local.md')).toBe('claude-md');
    });

    it('classifies CLAUDE.md under home directory', () => {
      expect(classifyConfigFile('/home/user/.claude/CLAUDE.md')).toBe('claude-md');
    });

    it('classifies CLAUDE.md in subdirectory', () => {
      expect(classifyConfigFile('/project/src/CLAUDE.md')).toBe('claude-md');
    });
  });

  describe('settings-json', () => {
    it('classifies settings.json', () => {
      expect(classifyConfigFile('.claude/settings.json')).toBe('settings-json');
    });

    it('classifies settings.local.json', () => {
      expect(classifyConfigFile('.claude/settings.local.json')).toBe('settings-json');
    });

    it('classifies managed-settings.json', () => {
      expect(classifyConfigFile('/Library/Application Support/ClaudeCode/managed-settings.json')).toBe('settings-json');
    });
  });

  describe('mcp-json', () => {
    it('classifies .mcp.json', () => {
      expect(classifyConfigFile('.mcp.json')).toBe('mcp-json');
    });

    it('classifies managed-mcp.json', () => {
      expect(classifyConfigFile('/etc/claude-code/managed-mcp.json')).toBe('mcp-json');
    });
  });

  describe('rule-md', () => {
    it('classifies rule in .claude/rules/', () => {
      expect(classifyConfigFile('.claude/rules/security.md')).toBe('rule-md');
    });

    it('classifies rule with absolute path', () => {
      expect(classifyConfigFile('/project/.claude/rules/testing.md')).toBe('rule-md');
    });
  });

  describe('agent-md', () => {
    it('classifies agent in .claude/agents/', () => {
      expect(classifyConfigFile('.claude/agents/researcher.md')).toBe('agent-md');
    });

    it('classifies user agent under home', () => {
      expect(classifyConfigFile('/home/user/.claude/agents/helper.md')).toBe('agent-md');
    });
  });

  describe('skill-md', () => {
    it('classifies SKILL.md', () => {
      expect(classifyConfigFile('.claude/skills/my-skill/SKILL.md')).toBe('skill-md');
    });

    it('classifies nested SKILL.md', () => {
      expect(classifyConfigFile('.claude/skills/category/name/SKILL.md')).toBe('skill-md');
    });
  });

  describe('command-md', () => {
    it('classifies command in .claude/commands/', () => {
      expect(classifyConfigFile('.claude/commands/deploy.md')).toBe('command-md');
    });

    it('classifies user command', () => {
      expect(classifyConfigFile('/home/user/.claude/commands/greet.md')).toBe('command-md');
    });
  });

  describe('case-insensitive classification', () => {
    it('classifies Claude.md as claude-md', () => {
      expect(classifyConfigFile('Claude.md')).toBe('claude-md');
    });

    it('classifies claude.md as claude-md', () => {
      expect(classifyConfigFile('claude.md')).toBe('claude-md');
    });

    it('classifies CLAUDE.MD as claude-md', () => {
      expect(classifyConfigFile('CLAUDE.MD')).toBe('claude-md');
    });

    it('classifies claude.local.md as claude-md', () => {
      expect(classifyConfigFile('claude.local.md')).toBe('claude-md');
    });

    it('classifies Settings.json as settings-json', () => {
      expect(classifyConfigFile('Settings.json')).toBe('settings-json');
    });

    it('classifies SETTINGS.JSON as settings-json', () => {
      expect(classifyConfigFile('SETTINGS.JSON')).toBe('settings-json');
    });

    it('classifies skill.md as skill-md', () => {
      expect(classifyConfigFile('.claude/skills/my-skill/skill.md')).toBe('skill-md');
    });

    it('classifies Skill.md as skill-md', () => {
      expect(classifyConfigFile('.claude/skills/my-skill/Skill.md')).toBe('skill-md');
    });
  });

  describe('unrecognized files', () => {
    it('returns null for random text files', () => {
      expect(classifyConfigFile('random-file.txt')).toBeNull();
    });

    it('returns null for package.json', () => {
      expect(classifyConfigFile('package.json')).toBeNull();
    });

    it('returns null for README.md', () => {
      expect(classifyConfigFile('README.md')).toBeNull();
    });

    it('returns null for arbitrary .md files', () => {
      expect(classifyConfigFile('docs/design.md')).toBeNull();
    });

    it('returns null for .ts files', () => {
      expect(classifyConfigFile('src/index.ts')).toBeNull();
    });
  });
});

describe('getExpectedFilenames', () => {
  it('returns canonical names for claude-md', () => {
    const names = getExpectedFilenames('claude-md');
    expect(names).toContain('CLAUDE.md');
    expect(names).toContain('CLAUDE.local.md');
  });

  it('returns canonical names for settings-json', () => {
    const names = getExpectedFilenames('settings-json');
    expect(names).toContain('settings.json');
    expect(names).toContain('settings.local.json');
    expect(names).toContain('managed-settings.json');
  });

  it('returns canonical names for mcp-json', () => {
    const names = getExpectedFilenames('mcp-json');
    expect(names).toContain('.mcp.json');
    expect(names).toContain('managed-mcp.json');
  });

  it('returns canonical name for skill-md', () => {
    expect(getExpectedFilenames('skill-md')).toEqual(['SKILL.md']);
  });

  it('returns empty array for rule-md', () => {
    expect(getExpectedFilenames('rule-md')).toEqual([]);
  });

  it('returns empty array for agent-md', () => {
    expect(getExpectedFilenames('agent-md')).toEqual([]);
  });

  it('returns empty array for command-md', () => {
    expect(getExpectedFilenames('command-md')).toEqual([]);
  });
});

describe('inferScope', () => {
  it('infers user scope for ~/.claude/ paths', () => {
    const home = process.env.HOME || '/home/user';
    expect(inferScope(`${home}/.claude/settings.json`, 'settings-json')).toBe('user');
  });

  it('infers project-local for .local. files', () => {
    expect(inferScope('.claude/settings.local.json', 'settings-json')).toBe('project-local');
  });

  it('infers project-local for CLAUDE.local.md', () => {
    expect(inferScope('/project/CLAUDE.local.md', 'claude-md')).toBe('project-local');
  });

  it('infers project-shared for project settings', () => {
    expect(inferScope('.claude/settings.json', 'settings-json')).toBe('project-shared');
  });

  it('infers enterprise for managed-settings.json', () => {
    expect(inferScope('/Library/Application Support/ClaudeCode/managed-settings.json', 'settings-json')).toBe('enterprise');
  });

  it('infers enterprise for managed-mcp.json', () => {
    expect(inferScope('/etc/claude-code/managed-mcp.json', 'mcp-json')).toBe('enterprise');
  });

  it('defaults to project-shared', () => {
    expect(inferScope('/project/.claude/rules/security.md', 'rule-md')).toBe('project-shared');
  });
});
