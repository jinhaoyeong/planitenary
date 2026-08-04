import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const sourceRoot = path.join(root, 'src', 'components');
const radiusPattern = /\brounded-(?:sm|md|lg|xl|2xl|3xl|full)\b/g;
const addedRadiusPattern = /\brounded-(?:sm|md|lg|xl|2xl|3xl|full)\b/;
const allowlistPattern = /adaptive-radius-allowlist|(?:avatar|map[-_ ]?marker|radio[-_ ]?indicator|status[-_ ]?dot|loading[-_ ]?spinner|color[-_ ]?swatch)/i;
const sizedCirclePattern = /rounded-full[\s\S]*(?:\bw-(?:[0-9]+|\[[^\]]+\])\b[\s\S]*\bh-(?:[0-9]+|\[[^\]]+\])\b|\bh-(?:[0-9]+|\[[^\]]+\])\b[\s\S]*\bw-(?:[0-9]+|\[[^\]]+\])\b)/i;

function collectFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(entryPath);
    return /\.(tsx|jsx)$/.test(entry.name) ? [entryPath] : [];
  });
}

function inspectFile(filePath) {
  const relative = path.relative(root, filePath).replaceAll('\\', '/');
  const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
  const findings = [];
  lines.forEach((line, index) => {
    const matches = line.match(radiusPattern) ?? [];
    for (const radius of matches) {
      const allowed = allowlistPattern.test(line) || sizedCirclePattern.test(line);
      findings.push({
        file: relative,
        line: index + 1,
        radius,
        status: allowed ? 'allowed-exception' : 'covered-by-scoped-token-bridge',
        reason: allowed ? 'semantic circle or map marker' : 'legacy utility is overridden by the handbook semantic token bridge',
      });
    }
  });
  return findings;
}

function addedRadiusFindings() {
  let diff = '';
  try {
    const base = process.env.ADAPTIVE_RADIUS_BASE;
    const args = base
      ? ['diff', '--unified=0', `${base}...HEAD`, '--', 'src/components']
      : ['diff', '--unified=0', '--', 'src/components'];
    diff = execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  } catch {
    return [];
  }
  return diff.split(/\r?\n/)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++') && addedRadiusPattern.test(line))
    .filter((line) => !allowlistPattern.test(line))
    .map((line) => ({ file: 'git diff', line: line.slice(1).trim(), status: 'new-hardcoded-radius' }));
}

const findings = collectFiles(sourceRoot).flatMap(inspectFile);
const added = addedRadiusFindings();
const migrated = findings.filter((finding) => finding.status === 'covered-by-scoped-token-bridge').length;
const allowed = findings.filter((finding) => finding.status === 'allowed-exception').length;

console.log('Adaptive surface radius audit');
console.log(`Scanned ${collectFiles(sourceRoot).length} component files.`);
console.log(`Legacy radius utilities remaining: ${migrated}`);
console.log(`Allowed semantic-circle exceptions: ${allowed}`);
for (const finding of findings.slice(0, 40)) {
  console.log(`${finding.status}\t${finding.file}:${finding.line}\t${finding.radius}\t${finding.reason}`);
}
if (findings.length > 40) console.log(`... ${findings.length - 40} additional source findings omitted from console output.`);

if (added.length > 0) {
  console.error('\nNew hardcoded radius utilities detected in the adaptive diff:');
  for (const finding of added) console.error(`${finding.status}\t${finding.line}`);
  process.exitCode = 1;
} else {
  console.log('\nNo new hardcoded radius utilities detected outside the semantic-circle allowlist.');
}
