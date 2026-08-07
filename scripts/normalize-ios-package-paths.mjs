import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagePath = path.join(projectRoot, 'ios', 'App', 'CapApp-SPM', 'Package.swift');
const source = await readFile(packagePath, 'utf8');
const normalized = source.replace(
  /(path:\s*")([^"]+)(")/,
  (_, prefix, dependencyPath, suffix) => `${prefix}${dependencyPath.replaceAll('\\', '/')}${suffix}`,
);

if (normalized !== source) {
  await writeFile(packagePath, normalized, 'utf8');
}
