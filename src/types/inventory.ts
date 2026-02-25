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

export interface RuleFileInfo extends FileInfo {
  frontmatter: {
    paths?: string[];
    description?: string;
  };
  matchedFiles: string[];
  isDead: boolean;
}

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
  globalClaudeMd: FileInfo | null;
  projectClaudeMd: FileInfo | null;
  localClaudeMd: FileInfo | null;
  subdirClaudeMds: FileInfo[];
  autoMemory: FileInfo | null;
  autoMemoryTopics: FileInfo[];

  // Rules & agents & commands & skills
  rules: RuleFileInfo[];
  projectAgents: FileInfo[];
  userAgents: FileInfo[];
  projectCommands: FileInfo[];
  userCommands: FileInfo[];
  projectSkills: FileInfo[];

  // MCP
  projectMcp: FileInfo | null;
  managedMcp: FileInfo | null;

  // Plugins
  plugins: PluginInfo[];

  // Hooks
  hooks: HookInfo[];

  // Totals
  totalFiles: number;
  totalStartupTokens: number;
  totalOnDemandTokens: number;
}
