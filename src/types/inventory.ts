export type FileScope = 'enterprise' | 'user' | 'project-shared' | 'project-local';

export interface FileInfo {
  path: string;
  relativePath: string;
  exists: boolean;
  scope: FileScope;
  sizeBytes: number;
  lineCount: number;
  estimatedTokens: number;
  gitTracked: boolean;
  lastModified: Date;
}

// Scanner only provides FileInfo metadata for rules.
// Frontmatter, matchedFiles, and isDead are parser concerns — see ParsedRule in parsers/rules-md.ts.
export type RuleFileInfo = FileInfo;

export interface HookInfo {
  event: 'PreToolUse' | 'PostToolUse' | 'SessionStart' | 'Stop' | 'UserPromptSubmit';
  matcher: string;
  type: 'command' | 'prompt';
  command?: string;
  scriptExists?: boolean;
  source: string;
}

export interface PluginInfo {
  id: string;
  enabled: boolean;
  source: string;
  conflicts?: string[];
}

export interface ConfigInventory {
  projectRoot: string;
  gitRoot: string | null;

  // Settings layer
  userSettings: FileInfo | null;
  projectSettings: FileInfo | null;
  localSettings: FileInfo | null;
  managedSettings: FileInfo | null;
  preferences: FileInfo | null;

  // Memory layer
  enterpriseClaudeMd: FileInfo | null;
  globalClaudeMd: FileInfo | null;
  projectClaudeMd: FileInfo | null;
  localClaudeMd: FileInfo | null;
  subdirClaudeMds: FileInfo[];
  autoMemory: FileInfo | null;
  autoMemoryTopics: FileInfo[];

  // Rules & agents & commands & skills
  rules: RuleFileInfo[];
  userRules: RuleFileInfo[];
  projectAgents: FileInfo[];
  userAgents: FileInfo[];
  projectCommands: FileInfo[];
  userCommands: FileInfo[];
  projectSkills: FileInfo[];
  userSkills: FileInfo[];

  // MCP
  projectMcp: FileInfo | null;
  managedMcp: FileInfo | null;

  // Plugins
  plugins: PluginInfo[];
  /** Agent files provided by installed plugins (e.g., from plugin cache directories). */
  pluginAgents: FileInfo[];

  // Hooks
  hooks: HookInfo[];

  // Totals
  totalFiles: number;
  totalStartupTokens: number;
  totalOnDemandTokens: number;
}
