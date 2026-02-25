import type { LintRule, LintIssue, ConfigInventory, ResolvedConfig } from '../../types/index.js';
import { parseClaudeMd } from '../../parsers/claude-md.js';

const DEFAULT_REQUIRED_SECTIONS = ['overview', 'commands', 'architecture'];

export const missingSectionsRule: LintRule = {
  id: 'memory/missing-sections',
  description: 'Check for recommended sections in project CLAUDE.md',
  severity: 'info',
  category: 'memory',

  check(inventory: ConfigInventory, _resolved: ResolvedConfig, options?: Record<string, unknown>): LintIssue[] {
    const issues: LintIssue[] = [];

    // Only check project CLAUDE.md
    if (!inventory.projectClaudeMd || !inventory.projectClaudeMd.exists) {
      return issues;
    }

    const parsed = parseClaudeMd(inventory.projectClaudeMd.path);
    if (!parsed) {
      return issues;
    }

    const requiredSections = (options?.required as string[] | undefined) ?? DEFAULT_REQUIRED_SECTIONS;

    const sectionChecks: Record<string, boolean> = {
      overview: parsed.hasOverview,
      commands: parsed.hasCommands,
      architecture: parsed.hasArchitecture,
    };

    for (const section of requiredSections) {
      const sectionKey = section.toLowerCase();
      const hasSection = sectionChecks[sectionKey];

      // If we have a known check for this section, use it
      // Otherwise, fall back to scanning section headings manually
      if (hasSection === false) {
        issues.push({
          ruleId: 'memory/missing-sections',
          severity: 'info',
          category: 'memory',
          message: `Project CLAUDE.md is missing a "${section}" section.`,
          file: inventory.projectClaudeMd.path,
          suggestion: `Add a ## ${section.charAt(0).toUpperCase() + section.slice(1)} section to help Claude understand your project.`,
          autoFixable: false,
        });
      } else if (hasSection === undefined) {
        // Custom section name not in the known checks — search parsed sections
        const found = parsed.sections.some(
          (s) => s.heading.toLowerCase().includes(sectionKey),
        );
        if (!found) {
          issues.push({
            ruleId: 'memory/missing-sections',
            severity: 'info',
            category: 'memory',
            message: `Project CLAUDE.md is missing a "${section}" section.`,
            file: inventory.projectClaudeMd.path,
            suggestion: `Add a ## ${section.charAt(0).toUpperCase() + section.slice(1)} section to help Claude understand your project.`,
            autoFixable: false,
          });
        }
      }
    }

    return issues;
  },
};
