import { describe, it, expect } from 'vitest';
import { join } from 'path';
import { scan } from '../../src/core/scanner.js';
import { buildDependencyGraph } from '../../src/core/graph-builder.js';
import type { DependencyGraph } from '../../src/types/index.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures');

describe('Graph Builder', () => {
  describe('graph-complex fixture', () => {
    const projectDir = join(FIXTURES, 'graph-complex');
    let graph: DependencyGraph;

    // Build graph once for all tests in this describe block
    function getGraph(): DependencyGraph {
      if (!graph) {
        const inventory = scan({ projectDir, skipGlobalDirs: true });
        graph = buildDependencyGraph(inventory, projectDir);
      }
      return graph;
    }

    // ─── Node creation tests ───

    it('creates correct total number of nodes (connected + orphans)', () => {
      const g = getGraph();
      const total = g.nodes.length + g.orphans.length;
      // Expected: CLAUDE.md (1), docs/setup.md (1, import target), agents (3), skills (2), commands (1), rules (2), MCP (1) = 11
      // Some may be orphaned, but the total should be 11
      expect(total).toBe(11);
    });

    it('creates CLAUDE.md nodes', () => {
      const g = getGraph();
      const allNodes = [...g.nodes, ...g.orphans];
      const claudeNodes = allNodes.filter((n) => n.type === 'claude-md');
      expect(claudeNodes.length).toBe(2); // Project CLAUDE.md + docs/setup.md (import target)
    });

    it('creates agent nodes', () => {
      const g = getGraph();
      const allNodes = [...g.nodes, ...g.orphans];
      const agentNodes = allNodes.filter((n) => n.type === 'agent');
      expect(agentNodes.length).toBe(3);
      const names = agentNodes.map((n) => n.label).sort();
      expect(names).toEqual(['architect', 'orphan-bot', 'reviewer']);
    });

    it('creates skill nodes', () => {
      const g = getGraph();
      const allNodes = [...g.nodes, ...g.orphans];
      const skillNodes = allNodes.filter((n) => n.type === 'skill');
      expect(skillNodes.length).toBe(2);
      const names = skillNodes.map((n) => n.label).sort();
      expect(names).toEqual(['code-review', 'design-patterns']);
    });

    it('creates command nodes', () => {
      const g = getGraph();
      const allNodes = [...g.nodes, ...g.orphans];
      const cmdNodes = allNodes.filter((n) => n.type === 'command');
      expect(cmdNodes.length).toBe(1);
      expect(cmdNodes[0].label).toBe('deploy');
    });

    it('creates rule nodes', () => {
      const g = getGraph();
      const allNodes = [...g.nodes, ...g.orphans];
      const ruleNodes = allNodes.filter((n) => n.type === 'rule');
      expect(ruleNodes.length).toBe(2);
      const names = ruleNodes.map((n) => n.label).sort();
      expect(names).toEqual(['testing', 'typescript']);
    });

    it('creates MCP server node', () => {
      const g = getGraph();
      const allNodes = [...g.nodes, ...g.orphans];
      const mcpNodes = allNodes.filter((n) => n.type === 'mcp-server');
      expect(mcpNodes.length).toBe(1);
      expect(mcpNodes[0].label).toBe('github');
    });

    it('node IDs follow "type:relativePath" format', () => {
      const g = getGraph();
      const allNodes = [...g.nodes, ...g.orphans];
      for (const node of allNodes) {
        expect(node.id).toMatch(/^[\w-]+:.+/);
        expect(node.id.startsWith(`${node.type}:`)).toBe(true);
      }
    });

    it('nodes have correct scope', () => {
      const g = getGraph();
      const allNodes = [...g.nodes, ...g.orphans];
      // All fixtures are project-level
      const projectNodes = allNodes.filter((n) => n.type !== 'mcp-server');
      for (const node of projectNodes) {
        expect(node.scope).toBe('project-shared');
      }
    });

    it('nodes have tokens > 0 for real files', () => {
      const g = getGraph();
      const allNodes = [...g.nodes, ...g.orphans];
      // Exclude MCP servers (virtual) and import-target nodes (created with tokens: 0)
      const fileNodes = allNodes.filter(
        (n) => n.type !== 'mcp-server' && !n.label.includes('/'),
      );
      for (const node of fileNodes) {
        expect(node.tokens).toBeGreaterThan(0);
      }
    });

    // ─── Edge extraction tests ───

    it('detects @import edge from CLAUDE.md to docs/setup.md', () => {
      const g = getGraph();
      const importEdges = g.edges.filter((e) => e.type === 'import');
      expect(importEdges.length).toBeGreaterThanOrEqual(1);
      const claudeToSetup = importEdges.find(
        (e) => e.source.includes('CLAUDE.md') && e.target.includes('setup.md'),
      );
      expect(claudeToSetup).toBeDefined();
      // docs/setup.md exists on disk — import is not broken.
      // A node is created for it even though it's not a config component.
      expect(claudeToSetup!.isBroken).toBe(false);
    });

    it('detects delegation edge from reviewer to architect', () => {
      const g = getGraph();
      const delegationEdges = g.edges.filter((e) => e.type === 'delegation');
      const reviewerToArchitect = delegationEdges.find(
        (e) => e.source.includes('reviewer') && e.target.includes('architect'),
      );
      expect(reviewerToArchitect).toBeDefined();
      expect(reviewerToArchitect!.isBroken).toBe(false);
    });

    it('detects delegation edge from architect to reviewer (cycle)', () => {
      const g = getGraph();
      const delegationEdges = g.edges.filter((e) => e.type === 'delegation');
      const architectToReviewer = delegationEdges.find(
        (e) => e.source.includes('architect') && e.target.includes('reviewer'),
      );
      expect(architectToReviewer).toBeDefined();
      expect(architectToReviewer!.isBroken).toBe(false);
    });

    it('detects skill reference edge from reviewer to code-review', () => {
      const g = getGraph();
      const refEdges = g.edges.filter((e) => e.type === 'reference');
      const reviewerToSkill = refEdges.find(
        (e) => e.source.includes('reviewer') && e.target.includes('code-review'),
      );
      expect(reviewerToSkill).toBeDefined();
      expect(reviewerToSkill!.isBroken).toBe(false);
    });

    it('detects skill reference edge from architect to design-patterns', () => {
      const g = getGraph();
      const refEdges = g.edges.filter((e) => e.type === 'reference');
      const architectToSkill = refEdges.find(
        (e) => e.source.includes('architect') && e.target.includes('design-patterns'),
      );
      expect(architectToSkill).toBeDefined();
      expect(architectToSkill!.isBroken).toBe(false);
    });

    it('detects CLAUDE.md reference to reviewer agent via name mention', () => {
      const g = getGraph();
      const refEdges = g.edges.filter((e) => e.type === 'reference');
      const claudeToReviewer = refEdges.find(
        (e) => e.source.includes('CLAUDE.md') && e.target.includes('reviewer'),
      );
      expect(claudeToReviewer).toBeDefined();
    });

    it('detects CLAUDE.md reference to architect agent via name mention', () => {
      const g = getGraph();
      const refEdges = g.edges.filter((e) => e.type === 'reference');
      const claudeToArchitect = refEdges.find(
        (e) => e.source.includes('CLAUDE.md') && e.target.includes('architect'),
      );
      expect(claudeToArchitect).toBeDefined();
    });

    it('detects skill-to-agent back-reference (code-review skill references reviewer)', () => {
      const g = getGraph();
      const refEdges = g.edges.filter((e) => e.type === 'reference');
      const skillToAgent = refEdges.find(
        (e) => e.source.includes('code-review') && e.target.includes('reviewer'),
      );
      expect(skillToAgent).toBeDefined();
    });

    it('does not create duplicate edges', () => {
      const g = getGraph();
      const edgeKeys = g.edges.map((e) => `${e.source}|${e.target}|${e.type}`);
      const uniqueKeys = new Set(edgeKeys);
      expect(edgeKeys.length).toBe(uniqueKeys.size);
    });

    // ─── Orphan detection tests ───

    it('detects orphan-bot as an orphan', () => {
      const g = getGraph();
      const orphanBot = g.orphans.find((n) => n.label === 'orphan-bot');
      expect(orphanBot).toBeDefined();
      expect(orphanBot!.type).toBe('agent');
    });

    it('detects deploy command as an orphan', () => {
      const g = getGraph();
      const deployCmd = g.orphans.find((n) => n.label === 'deploy');
      expect(deployCmd).toBeDefined();
      expect(deployCmd!.type).toBe('command');
    });

    it('rules with no references are orphans', () => {
      const g = getGraph();
      const orphanRules = g.orphans.filter((n) => n.type === 'rule');
      expect(orphanRules.length).toBe(2); // typescript and testing rules
    });

    it('connected agents are NOT in orphans', () => {
      const g = getGraph();
      const orphanAgentNames = g.orphans.filter((n) => n.type === 'agent').map((n) => n.label);
      expect(orphanAgentNames).not.toContain('reviewer');
      expect(orphanAgentNames).not.toContain('architect');
    });

    it('connected skills are NOT in orphans', () => {
      const g = getGraph();
      const orphanSkillNames = g.orphans.filter((n) => n.type === 'skill').map((n) => n.label);
      expect(orphanSkillNames).not.toContain('code-review');
      expect(orphanSkillNames).not.toContain('design-patterns');
    });
  });

  describe('graph-broken-refs fixture', () => {
    const projectDir = join(FIXTURES, 'graph-broken-refs');

    it('creates broken edge for agent referencing non-existent skill', () => {
      const inventory = scan({ projectDir, skipGlobalDirs: true });
      const graph = buildDependencyGraph(inventory, projectDir);

      const brokenSkillRef = graph.edges.find(
        (e) => e.type === 'reference' && e.target.includes('nonexistent-tool') && e.isBroken,
      );
      expect(brokenSkillRef).toBeDefined();
    });

    it('creates broken edge for agent delegating to non-existent agent', () => {
      const inventory = scan({ projectDir, skipGlobalDirs: true });
      const graph = buildDependencyGraph(inventory, projectDir);

      const brokenDelegation = graph.edges.find(
        (e) => e.type === 'delegation' && e.target.includes('ghost-agent') && e.isBroken,
      );
      expect(brokenDelegation).toBeDefined();
    });

    it('creates broken edge for CLAUDE.md @import to missing file', () => {
      const inventory = scan({ projectDir, skipGlobalDirs: true });
      const graph = buildDependencyGraph(inventory, projectDir);

      const brokenImport = graph.edges.find(
        (e) => e.type === 'import' && e.target.includes('missing-file') && e.isBroken,
      );
      expect(brokenImport).toBeDefined();
    });
  });

  describe('minimal-project fixture (edge case)', () => {
    const projectDir = join(FIXTURES, 'minimal-project');

    it('produces graph with CLAUDE.md node only', () => {
      const inventory = scan({ projectDir, skipGlobalDirs: true });
      const graph = buildDependencyGraph(inventory, projectDir);

      const allNodes = [...graph.nodes, ...graph.orphans];
      expect(allNodes.length).toBeGreaterThanOrEqual(1);
      const claudeNodes = allNodes.filter((n) => n.type === 'claude-md');
      expect(claudeNodes.length).toBe(1);
    });

    it('has no agents/skills/commands', () => {
      const inventory = scan({ projectDir, skipGlobalDirs: true });
      const graph = buildDependencyGraph(inventory, projectDir);

      const allNodes = [...graph.nodes, ...graph.orphans];
      expect(allNodes.filter((n) => n.type === 'agent').length).toBe(0);
      expect(allNodes.filter((n) => n.type === 'skill').length).toBe(0);
      expect(allNodes.filter((n) => n.type === 'command').length).toBe(0);
    });

    it('CLAUDE.md with no references is an orphan', () => {
      const inventory = scan({ projectDir, skipGlobalDirs: true });
      const graph = buildDependencyGraph(inventory, projectDir);

      // In minimal project, CLAUDE.md has no @imports or agent/skill references
      // So it should be an orphan
      expect(graph.orphans.length).toBeGreaterThanOrEqual(1);
    });
  });
});
