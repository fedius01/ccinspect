export type {
  FileScope,
  FileInfo,
  RuleFileInfo,
  HookInfo,
  PluginInfo,
  ConfigInventory,
} from './inventory.js';

export type {
  OriginTracked,
  PermissionRule,
  PermissionConflict,
  PermissionRedundancy,
  EnvVariable,
  McpServerResolved,
  ResolvedConfig,
} from './resolved.js';

export type {
  Severity,
  IssueCategory,
  LintEvidence,
  LintIssue,
  LintRule,
  LintConfig,
  LintResult,
} from './lint.js';

export type { AuthMethod, OsType, RuntimeInfo } from './runtime.js';

export type {
  GraphNodeType,
  GraphEdgeType,
  GraphNode,
  GraphEdge,
  DependencyGraph,
} from './graph.js';

import type { FileScope, ConfigInventory as CI } from './inventory.js';
import type { ResolvedConfig as RC } from './resolved.js';

export type ConfigFileType =
  | 'claude-md'
  | 'settings-json'
  | 'mcp-json'
  | 'rule-md'
  | 'agent-md'
  | 'skill-md'
  | 'command-md';

export interface SingleFileContext {
  fileType: ConfigFileType;
  filePath: string;
  scope: FileScope;
  inventory: CI;
  resolved: RC;
}
