import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const validator = resolve('bench/validate-metadata.mjs');
const run = args => new Promise((resolveRun, reject) => {
  const child = spawn(process.execPath, [validator, ...args], { cwd: resolve('.') });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('error', reject);
  child.on('close', code => resolveRun({ code, stdout, stderr }));
});

const skill = ({ name, description = 'Inspect a focused workflow.', keywords = ['focused workflow'] }) => `---\nname: ${name}\ndescription: ${description}\nkeywords: ${JSON.stringify(keywords)}\n---\nInstructions\n`;

test('metadata validator accepts specific versioned keywords and rejects normalized duplicates or generic keywords', async t => {
  const root = await mkdtemp(join(tmpdir(), 'skillar-metadata-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'database-query'));
  await writeFile(join(root, 'database-query/SKILL.md'), skill({
    name: 'database-query',
    description: 'Inspect SQL query plans and slow database access.',
    keywords: ['DB', '디비', 'database query'],
  }));
  const valid = await run(['--skills-root', root]);
  assert.equal(valid.code, 0, valid.stderr);
  assert.deepEqual(JSON.parse(valid.stdout), { valid: true, skills: 1, errors: [] });

  await mkdir(join(root, 'bad-metadata'));
  await writeFile(join(root, 'bad-metadata/SKILL.md'), skill({ name: 'bad-metadata', keywords: ['Workflow', 'workflow'] }));
  const invalid = await run(['--skills-root', root]);
  assert.equal(invalid.code, 1);
  const report = JSON.parse(invalid.stderr);
  assert.equal(report.valid, false);
  assert.ok(report.errors.some(error => /generic term/.test(error)));
  assert.ok(report.errors.some(error => /duplicates/.test(error)));
});
