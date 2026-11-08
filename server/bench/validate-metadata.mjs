import { readdir, readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { parse } from 'yaml';

const arg = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const genericKeywords = new Set([
  'ai', 'assistant', 'help', 'please', 'skill', 'skills', 'task', 'tasks', 'workflow', 'workflows',
  '도움', '도와줘', '스킬', '작업', '해줘', '해주세요', '요청',
]);
const normalize = value => value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

function frontmatter(markdown, source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) throw new Error(`${source}: missing YAML frontmatter`);
  try {
    const metadata = parse(match[1]);
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('frontmatter must be a mapping');
    return metadata;
  } catch (error) {
    throw new Error(`${source}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function skillFiles(root) {
  const files = [];
  async function visit(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name === 'SKILL.md') files.push(path);
    }
  }
  await visit(root);
  return files.sort();
}

async function sourceDocuments() {
  const root = arg('--skills-root');
  const inventory = arg('--inventory');
  if (!!root === !!inventory) throw new Error('Usage: node validate-metadata.mjs (--skills-root /absolute/path/to/skills | --inventory path.json)');
  if (inventory) {
    const rows = JSON.parse(await readFile(resolve(inventory), 'utf8'));
    if (!Array.isArray(rows)) throw new Error(`${inventory}: inventory must be an array`);
    return rows.map((metadata, index) => ({ source: `${inventory}[${index}]`, metadata }));
  }
  const files = await skillFiles(resolve(root));
  if (!files.length) throw new Error(`${root}: no SKILL.md files found`);
  return Promise.all(files.map(async path => ({
    source: path,
    directory: basename(dirname(path)),
    metadata: frontmatter(await readFile(path, 'utf8'), path),
  })));
}

function validate(documents) {
  const errors = [];
  for (const { source, directory, metadata } of documents) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      errors.push(`${source}: metadata must be a mapping`);
      continue;
    }
    if (typeof metadata.name !== 'string' || !metadata.name.trim()) errors.push(`${source}: name must be a nonempty string`);
    else if (directory && metadata.name !== directory) errors.push(`${source}: name must equal its containing directory (${directory})`);
    if (typeof metadata.description !== 'string' || !metadata.description.trim()) errors.push(`${source}: description must be a nonempty string`);
    if (!Array.isArray(metadata.keywords) || !metadata.keywords.length) {
      errors.push(`${source}: keywords must be a nonempty string array`);
      continue;
    }
    const seen = new Map();
    metadata.keywords.forEach((keyword, index) => {
      if (typeof keyword !== 'string' || !normalize(keyword)) {
        errors.push(`${source}: keywords[${index}] must be a nonempty string`);
        return;
      }
      const normalized = normalize(keyword);
      if (Array.from(normalized).length < 2) errors.push(`${source}: keywords[${index}] is too short; use a specific discovery term`);
      if (genericKeywords.has(normalized)) errors.push(`${source}: keywords[${index}] is a generic term; pair it with a domain-specific discovery term`);
      const first = seen.get(normalized);
      if (first !== undefined) errors.push(`${source}: keywords[${index}] duplicates keywords[${first}] after search normalization`);
      else seen.set(normalized, index);
    });
  }
  return errors;
}

try {
  const documents = await sourceDocuments();
  const errors = validate(documents);
  const report = { valid: errors.length === 0, skills: documents.length, errors };
  (errors.length ? console.error : console.log)(JSON.stringify(report, null, 2));
  if (errors.length) process.exitCode = 1;
} catch (error) {
  console.error(JSON.stringify({ valid: false, errors: [error instanceof Error ? error.message : String(error)] }, null, 2));
  process.exitCode = 1;
}
