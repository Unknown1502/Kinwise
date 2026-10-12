/**
 * Prints the Kinwise-vs-door-only scenario table. With --write, rewrites docs/evaluation.md.
 *   npm run scenarios -w @kinwise/hub [-- --write]
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdown, runScenarios } from '../src/eval/scenarios.js';

const markdown = renderMarkdown(await runScenarios());
if (process.argv.includes('--write')) {
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs', 'evaluation.md');
  writeFileSync(file, markdown, 'utf8');
  console.log(`wrote ${file}`);
} else {
  console.log(markdown);
}
