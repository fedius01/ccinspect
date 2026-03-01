export type GraphNodeType = 'claude-md' | 'rule' | 'agent' | 'skill' | 'command' | 'mcp-server';
export type GraphEdgeType = 'import' | 'reference' | 'delegation' | 'fork';

export interface GraphNode {
  id: string;                  // Unique: "type:relativePath" e.g. "agent:.claude/agents/reviewer.md"
  type: GraphNodeType;
  label: string;               // Human-friendly display name (e.g., "reviewer" not full path)
  filePath: string;            // Absolute path
  scope: 'enterprise' | 'user' | 'project-shared' | 'project-local';
  tokens: number;
  // Dynamic overlay fields (Phase 6 — optional, not populated yet)
  usageCount?: number;
  lastUsed?: Date;
  isGhost?: boolean;
}

export interface GraphEdge {
  source: string;              // Node id
  target: string;              // Node id
  type: GraphEdgeType;
  isBroken: boolean;           // true if target node doesn't exist in graph
  // Dynamic overlay (Phase 6 — optional, not populated yet)
  traversalCount?: number;
  isUnexpected?: boolean;
}

export interface DependencyGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  orphans: GraphNode[];        // Nodes with zero incoming AND zero outgoing edges
}
