import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'path';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import { execSync } from 'child_process';

const FIXTURES = join(import.meta.dirname, '..', '..', 'fixtures');
const CLI_ENTRY = join(import.meta.dirname, '..', '..', '..', 'src', 'cli', 'index.ts');
const TSX = 'npx tsx';

function runCli(args: string): string {
  // eslint-disable-next-line sonarjs/os-command -- Test helper executing CLI for integration testing
  return execSync(`${TSX} ${CLI_ENTRY} ${args}`, {
    encoding: 'utf-8',
    timeout: 15000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
}

describe('cci graph command', () => {
  const tmpFiles: string[] = [];

  afterEach(() => {
    for (const f of tmpFiles) {
      if (existsSync(f)) unlinkSync(f);
    }
    tmpFiles.length = 0;
  });

  describe('graph-complex fixture', () => {
    const projectDir = join(FIXTURES, 'graph-complex');

    it('produces text output by default', () => {
      const output = runCli(`graph --project-dir ${projectDir}`);
      expect(output).toContain('Dependency Graph');
      expect(output).toContain('nodes');
      expect(output).toContain('edges');
    });

    it('produces mermaid output with --format mermaid', () => {
      const output = runCli(`graph --format mermaid --project-dir ${projectDir}`);
      expect(output).toContain('graph TD');
      expect(output).toContain('-->');
    });

    it('produces valid JSON with --format json', () => {
      const output = runCli(`graph --format json --project-dir ${projectDir}`);
      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty('nodes');
      expect(parsed).toHaveProperty('edges');
      expect(parsed).toHaveProperty('orphans');
    });

    it('writes to file with --output', () => {
      const outputFile = join('/tmp', `graph-test-${Date.now()}.mermaid`);
      tmpFiles.push(outputFile);
      const stdout = runCli(`graph --format mermaid --output ${outputFile} --project-dir ${projectDir}`);
      expect(stdout).toContain(outputFile);
      expect(existsSync(outputFile)).toBe(true);
      const contents = readFileSync(outputFile, 'utf-8');
      expect(contents).toContain('graph TD');
    });

    it('writes html to file with --output', () => {
      const outputFile = join('/tmp', `graph-test-${Date.now()}.html`);
      tmpFiles.push(outputFile);
      const stdout = runCli(`graph --format html --output ${outputFile} --project-dir ${projectDir}`);
      expect(stdout).toContain(outputFile);
      const contents = readFileSync(outputFile, 'utf-8');
      expect(contents).toContain('<!DOCTYPE html>');
      expect(contents).toContain('mermaid');
    });
  });

  describe('minimal-project fixture', () => {
    const projectDir = join(FIXTURES, 'minimal-project');

    it('does not crash on sparse graph', () => {
      const output = runCli(`graph --project-dir ${projectDir}`);
      expect(output).toContain('Dependency Graph');
    });

    it('produces valid JSON for sparse graph', () => {
      const output = runCli(`graph --format json --project-dir ${projectDir}`);
      const parsed = JSON.parse(output);
      expect(parsed).toHaveProperty('nodes');
      expect(parsed).toHaveProperty('orphans');
    });
  });
});
