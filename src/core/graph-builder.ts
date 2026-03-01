import { basename, relative } from 'path';
import type {
  ConfigInventory,
  FileInfo,
  GraphNode,
  GraphEdge,
  GraphNodeType,
  DependencyGraph,
} from '../types/index.js';
import { parseClaudeMd } from '../parsers/claude-md.js';
import { parseAgentMd } from '../parsers/agents-md.js';
import { parseMcpJson } from '../parsers/mcp-json.js';
import {
  findAgentReferences,
  findSkillReferences,
  readMarkdownContent,
  nameMatchesInText,
} from '../utils/references.js';

/**
 * Build a unique node ID from type and relative path.
 * Format: "type:relativePath" e.g. "agent:.claude/agents/reviewer.md"
 */
function makeNodeId(type: GraphNodeType, relativePath: string): string {
  return `${type}:${relativePath}`;
}

/**
 * Derive a human-friendly label from a file path.
 * - Agents/commands: filename without .md extension (e.g. "reviewer")
 * - Skills: parent directory name (e.g. "code-review" from .claude/skills/code-review/SKILL.md)
 * - Rules: filename without .md extension
 * - CLAUDE.md: scope-qualified name (e.g. "CLAUDE.md (project)")
 * - MCP servers: server name as-is
 */
function deriveLabel(type: GraphNodeType, filePath: string, scope: string): string {
  switch (type) {
    case 'claude-md':
      return `CLAUDE.md (${scope})`;
    case 'skill': {
      const parts = filePath.split('/');
      const skillMdIdx = parts.indexOf('SKILL.md');
      if (skillMdIdx > 0) {
        return parts[skillMdIdx - 1];
      }
      return basename(filePath, '.md');
    }
    case 'mcp-server':
      return basename(filePath);
    default:
      return basename(filePath, '.md');
  }
}

/**
 * Build a directed dependency graph from a ConfigInventory.
 *
 * Creates nodes for every config component (CLAUDE.md files, rules, agents, skills,
 * commands, MCP servers) and edges representing their relationships (@imports,
 * delegations, skill references, name mentions).
 *
 * Note for consumers: The graph may contain cycles (e.g. Agent A delegates to Agent B
 * which delegates back to Agent A). If you need to traverse the graph, use BFS/DFS
 * with a visited set.
 */
export function buildDependencyGraph(
  inventory: ConfigInventory,
  projectRoot: string,
): DependencyGraph {
  const nodeMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  // Helper: add a node to the map (skip non-existent files)
  function addNode(type: GraphNodeType, file: FileInfo): GraphNode | null {
    if (!file.exists) return null;
    const relPath = relative(projectRoot, file.path) || file.relativePath;
    const id = makeNodeId(type, relPath);
    if (nodeMap.has(id)) return nodeMap.get(id)!;
    const node: GraphNode = {
      id,
      type,
      label: deriveLabel(type, file.path, file.scope),
      filePath: file.path,
      scope: file.scope,
      tokens: file.estimatedTokens,
    };
    nodeMap.set(id, node);
    return node;
  }

  // Helper: add an edge (deduplicates by source+target+type)
  const edgeSet = new Set<string>();
  function addEdge(source: string, target: string, type: GraphEdge['type'], isBroken: boolean): void {
    const key = `${source}|${target}|${type}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push({ source, target, type, isBroken });
  }

  // ─── 3a. Create nodes ───

  // CLAUDE.md files
  const claudeMdFiles: FileInfo[] = [
    inventory.globalClaudeMd,
    inventory.projectClaudeMd,
    inventory.localClaudeMd,
    ...inventory.subdirClaudeMds,
    inventory.autoMemory,
  ].filter((f): f is FileInfo => f !== null && f.exists);

  for (const file of claudeMdFiles) {
    addNode('claude-md', file);
  }

  // Rules
  for (const rule of inventory.rules) {
    if (rule.exists) {
      addNode('rule', rule);
    }
  }

  // Agents
  const allAgents = [...inventory.projectAgents, ...inventory.userAgents];
  for (const agent of allAgents) {
    addNode('agent', agent);
  }

  // Skills
  for (const skill of inventory.projectSkills) {
    addNode('skill', skill);
  }

  // Commands
  const allCommands = [...inventory.projectCommands, ...inventory.userCommands];
  for (const cmd of allCommands) {
    addNode('command', cmd);
  }

  // MCP servers — create virtual nodes from parsed .mcp.json
  if (inventory.projectMcp?.exists) {
    const parsed = parseMcpJson(inventory.projectMcp.path, 'project');
    if (parsed) {
      for (const server of parsed.servers) {
        const relPath = `.mcp.json#${server.name}`;
        const id = makeNodeId('mcp-server', relPath);
        if (!nodeMap.has(id)) {
          nodeMap.set(id, {
            id,
            type: 'mcp-server',
            label: server.name,
            filePath: inventory.projectMcp.path,
            scope: 'project-shared',
            tokens: 0,
          });
        }
      }
    }
  }

  // Build lookup tables for name-based edge resolution
  const agentNameToNode = new Map<string, GraphNode>();
  for (const node of nodeMap.values()) {
    if (node.type === 'agent') {
      agentNameToNode.set(node.label.toLowerCase(), node);
    }
  }

  const skillNameToNode = new Map<string, GraphNode>();
  for (const node of nodeMap.values()) {
    if (node.type === 'skill') {
      skillNameToNode.set(node.label.toLowerCase(), node);
    }
  }

  const mcpServerNameToNode = new Map<string, GraphNode>();
  for (const node of nodeMap.values()) {
    if (node.type === 'mcp-server') {
      mcpServerNameToNode.set(node.label.toLowerCase(), node);
    }
  }

  // ─── 3b. Extract edges ───

  // 1. @import edges from CLAUDE.md files
  for (const file of claudeMdFiles) {
    const parsed = parseClaudeMd(file.path);
    if (!parsed) continue;

    const sourceRelPath = relative(projectRoot, file.path) || file.relativePath;
    const sourceId = makeNodeId('claude-md', sourceRelPath);

    for (const imp of parsed.importChain.filter((e) => e.depth === 1)) {
      if (imp.resolvedPath) {
        const targetRelPath = relative(projectRoot, imp.resolvedPath);
        // Try to find an existing node for this imported file
        const targetId = findImportTargetNode(targetRelPath) ?? makeNodeId('claude-md', targetRelPath);
        const isBroken = !nodeMap.has(targetId);
        addEdge(sourceId, targetId, 'import', isBroken);
      } else {
        // Import target doesn't exist — broken reference
        const targetId = makeNodeId('claude-md', imp.path);
        addEdge(sourceId, targetId, 'import', true);
      }
    }
  }

  // 2. Agent delegation edges (agent → agent)
  for (const agent of allAgents) {
    if (!agent.exists) continue;
    const parsed = parseAgentMd(agent.path);
    if (!parsed) continue;

    const sourceRelPath = relative(projectRoot, agent.path);
    const sourceId = makeNodeId('agent', sourceRelPath);

    const refs = findAgentReferences(parsed.content);
    for (const refName of refs) {
      const targetNode = agentNameToNode.get(refName);
      if (targetNode) {
        addEdge(sourceId, targetNode.id, 'delegation', false);
      } else {
        // Broken delegation — target agent doesn't exist
        const targetId = makeNodeId('agent', `.claude/agents/${refName}.md`);
        addEdge(sourceId, targetId, 'delegation', true);
      }
    }
  }

  // 3. Skill reference edges (agent → skill)
  for (const agent of allAgents) {
    if (!agent.exists) continue;
    const parsed = parseAgentMd(agent.path);
    if (!parsed) continue;

    const sourceRelPath = relative(projectRoot, agent.path);
    const sourceId = makeNodeId('agent', sourceRelPath);

    const refs = findSkillReferences(parsed.content);
    for (const refName of refs) {
      const targetNode = skillNameToNode.get(refName);
      if (targetNode) {
        addEdge(sourceId, targetNode.id, 'reference', false);
      } else {
        // Broken reference — target skill doesn't exist
        const targetId = makeNodeId('skill', `.claude/skills/${refName}/SKILL.md`);
        addEdge(sourceId, targetId, 'reference', true);
      }
    }
  }

  // 4. CLAUDE.md mention edges (CLAUDE.md → agent/skill via name mentions)
  for (const file of claudeMdFiles) {
    const content = readMarkdownContent(file.path);
    if (!content) continue;

    const sourceRelPath = relative(projectRoot, file.path) || file.relativePath;
    const sourceId = makeNodeId('claude-md', sourceRelPath);

    // Strip fenced code blocks to avoid false matches
    const contentWithoutCodeBlocks = stripFencedCodeBlocks(content);

    // Check agent name mentions
    for (const [name, targetNode] of agentNameToNode) {
      if (nameMatchesInText(contentWithoutCodeBlocks, name)) {
        addEdge(sourceId, targetNode.id, 'reference', false);
      }
    }

    // Check skill name mentions
    for (const [name, targetNode] of skillNameToNode) {
      if (nameMatchesInText(contentWithoutCodeBlocks, name)) {
        addEdge(sourceId, targetNode.id, 'reference', false);
      }
    }

    // Check MCP server name mentions
    for (const [name, targetNode] of mcpServerNameToNode) {
      if (nameMatchesInText(contentWithoutCodeBlocks, name)) {
        addEdge(sourceId, targetNode.id, 'reference', false);
      }
    }
  }

  // 5. Skill → agent reference edges (skills mentioning agents)
  for (const skill of inventory.projectSkills) {
    if (!skill.exists) continue;
    const content = readMarkdownContent(skill.path);
    if (!content) continue;

    const sourceRelPath = relative(projectRoot, skill.path);
    const sourceId = makeNodeId('skill', sourceRelPath);
    if (!nodeMap.has(sourceId)) continue;

    const refs = findAgentReferences(content);
    for (const refName of refs) {
      const targetNode = agentNameToNode.get(refName);
      if (targetNode) {
        addEdge(sourceId, targetNode.id, 'reference', false);
      }
    }
  }

  // ─── 3c. Detect orphans ───
  const nodesWithEdges = new Set<string>();
  for (const edge of edges) {
    nodesWithEdges.add(edge.source);
    if (!edge.isBroken) {
      nodesWithEdges.add(edge.target);
    }
  }

  const orphans: GraphNode[] = [];
  const connectedNodes: GraphNode[] = [];

  for (const node of nodeMap.values()) {
    if (nodesWithEdges.has(node.id)) {
      connectedNodes.push(node);
    } else {
      orphans.push(node);
    }
  }

  return {
    nodes: connectedNodes,
    edges,
    orphans,
  };

  // ─── Internal helpers ───

  /**
   * Try to find an existing node for an imported file path.
   * Import targets can be CLAUDE.md files or other markdown files.
   */
  function findImportTargetNode(targetRelPath: string): string | null {
    // Check if there's already a node with this relative path (any type)
    for (const node of nodeMap.values()) {
      const nodeRelPath = relative(projectRoot, node.filePath);
      if (nodeRelPath === targetRelPath) {
        return node.id;
      }
    }
    return null;
  }
}

/**
 * Strip fenced code blocks (``` ... ```) from markdown content
 * to avoid false positive name matches in code examples.
 */
function stripFencedCodeBlocks(content: string): string {
  return content.replace(/```[\s\S]*?```/g, '');
}
