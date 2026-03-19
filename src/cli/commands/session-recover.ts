import type { Command } from 'commander';
import { resolve as resolvePath } from 'path';
import chalk from 'chalk';
import { discoverTranscripts } from '../../utils/transcript-discovery.js';
import { parseTranscriptFile } from '../../parsers/transcript-jsonl.js';
import { assessRecovery, type RecoveryAssessment } from '../../core/session-recovery.js';
import { scan } from '../../core/scanner.js';
import { createExcluder } from '../../utils/excluder.js';
import { loadConfig } from '../../utils/config.js';
import { runHistoryReconstruction } from '../../core/history-integration.js';

export function registerSessionRecoverCommand(program: Command): void {
  program
    .command('session-recover')
    .description('Generate a recovery prompt from the last session transcript')
    .option('--session <uuid>', 'Recover from a specific session')
    .option('--latest', 'Use the most recent session (default behavior)')
    .action(async (_options, cmd) => {
      const globalOpts = cmd.optsWithGlobals();
      const projectDir = globalOpts.projectDir as string | undefined;
      const format = globalOpts.format as string | undefined;
      const sessionId = _options.session as string | undefined;

      const resolvedProjectDir = resolvePath(projectDir || process.cwd());

      // Run history reconstruction (non-blocking — errors are swallowed internally)
      const excluder = createExcluder(resolvedProjectDir, {
        cliPatterns: (globalOpts.exclude as string[] | undefined) ?? [],
      });
      const inventory = scan({ projectDir: resolvedProjectDir, excluder });
      const ccinspectConfig = loadConfig(resolvedProjectDir);
      await runHistoryReconstruction(resolvedProjectDir, inventory, 'session-recover', ccinspectConfig.history);

      // 1. Discover transcripts
      const discovery = await discoverTranscripts(resolvedProjectDir);

      if (!discovery || discovery.sessionFiles.length === 0) {
        if (format === 'json') {
          console.log(JSON.stringify({ error: 'No transcript files found', sessionId: null }, null, 2));
        } else {
          console.log();
          console.log(chalk.bold('ccinspect session-recover'));
          console.log();
          console.log(
            chalk.yellow(
              'No transcript files found. Run Claude Code sessions first, then re-run cci session-recover.',
            ),
          );
          console.log(
            chalk.dim('Claude Code transcripts are stored in ~/.claude/projects/.'),
          );
          console.log();
        }
        return;
      }

      // 2. Find target session
      let targetFile = discovery.sessionFiles[0]; // default: latest

      if (sessionId) {
        const match = discovery.sessionFiles.find((f) => f.sessionId === sessionId);
        if (!match) {
          if (format === 'json') {
            console.log(JSON.stringify({ error: `Session ${sessionId} not found`, sessionId }, null, 2));
          } else {
            console.log();
            console.log(chalk.red(`Session ${sessionId} not found.`));
            console.log(chalk.dim(`Available sessions: ${discovery.sessionFiles.map((f) => f.sessionId).slice(0, 5).join(', ')}${discovery.sessionFiles.length > 5 ? '…' : ''}`));
            console.log();
          }
          return;
        }
        targetFile = match;
      }

      // 3. Parse session (always fresh — recovery needs full events)
      const parseResult = await parseTranscriptFile(targetFile.filePath);

      // 4. Assess recovery
      const assessment = assessRecovery(parseResult, resolvedProjectDir);

      // 5. Output
      if (format === 'json') {
        printRecoveryJson(assessment);
      } else {
        printRecoveryTerminal(assessment);
      }
    });
}

// ---- Terminal output ----

function printRecoveryTerminal(assessment: RecoveryAssessment): void {
  console.log();
  console.log(chalk.bold('ccinspect session-recover'));
  console.log();

  // Header
  const dateStr = assessment.sessionDate.toISOString().replace('T', ' ').slice(0, 16);
  const shortId = assessment.sessionId.slice(0, 8);
  console.log(
    chalk.cyan('Session Recovery') +
    `  (session ${shortId} · ${dateStr})`,
  );
  console.log();

  // Status
  const statusColor = {
    complete: chalk.green,
    incomplete: chalk.yellow,
    failed: chalk.red,
    damaged: chalk.gray,
  }[assessment.status];

  const statusLabel = {
    complete: 'Complete — session finished successfully',
    incomplete: 'Incomplete — session ended mid-task',
    failed: 'Failed — last action produced an error',
    damaged: 'Damaged — session transcript is corrupted',
  }[assessment.status];

  console.log(`  ${chalk.bold('Status:')}          ${statusColor(statusLabel)}`);

  // Last task
  if (assessment.lastTask) {
    const promptDisplay = assessment.lastTask.prompt.length > 80
      ? assessment.lastTask.prompt.slice(0, 80) + '…'
      : assessment.lastTask.prompt;
    console.log(`  ${chalk.bold('Last task:')}       "${promptDisplay}"`);

    if (assessment.lastTask.filesModified.length > 0) {
      const files = assessment.lastTask.filesModified;
      console.log(`  ${chalk.bold('Files modified:')}  ${files[0]}`);
      for (let i = 1; i < files.length; i++) {
        console.log(`                   ${files[i]}`);
      }
    }

    if (assessment.lastTask.filesRead.length > 0) {
      const files = assessment.lastTask.filesRead;
      console.log(`  ${chalk.bold('Files read:')}      ${files[0]}`);
      for (let i = 1; i < files.length; i++) {
        console.log(`                   ${files[i]}`);
      }
    }
  }

  // Checkpoint
  if (assessment.lastCheckpoint) {
    const cpTime = assessment.lastCheckpoint.timestamp.toISOString().slice(11, 16);
    console.log(`  ${chalk.bold('Last checkpoint:')} ${assessment.lastCheckpoint.description} at ${cpTime}`);
  }

  // Error
  if (assessment.lastError) {
    console.log();
    console.log(`  ${chalk.bold.red('Last error:')}`);
    const toolDesc = assessment.lastError.command
      ? `${assessment.lastError.toolName}: ${assessment.lastError.command}`
      : assessment.lastError.toolName;
    console.log(`    ${toolDesc}`);
    // Show error with indentation, limit to first 3 lines
    const errorLines = assessment.lastError.errorMessage.split('\n').slice(0, 3);
    for (const line of errorLines) {
      console.log(`    ${chalk.dim(line)}`);
    }
  }

  // Recovery prompt
  if (assessment.status === 'complete') {
    console.log();
    console.log(chalk.green('  Session completed successfully. No recovery needed.'));
  } else {
    console.log();
    console.log(`  ${chalk.bold('Recovery prompt:')}`);
    const border = '─'.repeat(60);
    console.log(`  ${chalk.dim(border)}`);
    for (const line of assessment.recoveryPrompt.split('\n')) {
      console.log(`  ${line}`);
    }
    console.log(`  ${chalk.dim(border)}`);
  }

  console.log();
}

// ---- JSON output ----

function printRecoveryJson(assessment: RecoveryAssessment): void {
  const output = {
    sessionId: assessment.sessionId,
    sessionDate: assessment.sessionDate.toISOString(),
    status: assessment.status,
    lastTask: assessment.lastTask
      ? {
          prompt: assessment.lastTask.prompt,
          startedAt: assessment.lastTask.startedAt.toISOString(),
          toolCallCount: assessment.lastTask.toolCallCount,
          filesModified: assessment.lastTask.filesModified,
          filesRead: assessment.lastTask.filesRead,
        }
      : null,
    lastCheckpoint: assessment.lastCheckpoint
      ? {
          description: assessment.lastCheckpoint.description,
          timestamp: assessment.lastCheckpoint.timestamp.toISOString(),
          toolName: assessment.lastCheckpoint.toolName,
          ...(assessment.lastCheckpoint.filePath
            ? { filePath: assessment.lastCheckpoint.filePath }
            : {}),
        }
      : null,
    lastError: assessment.lastError
      ? {
          toolName: assessment.lastError.toolName,
          ...(assessment.lastError.command
            ? { command: assessment.lastError.command }
            : {}),
          errorMessage: assessment.lastError.errorMessage,
          timestamp: assessment.lastError.timestamp.toISOString(),
        }
      : null,
    recoveryPrompt: assessment.recoveryPrompt,
  };

  console.log(JSON.stringify(output, null, 2));
}
