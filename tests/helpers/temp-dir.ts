import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let tempDirs: string[] = [];

export function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'secvuln-'));
  tempDirs.push(dir);
  return dir;
}

export function writeTempFile(dir: string, filename: string, content: string): string {
  const filePath = join(dir, filename);
  const fileDir = join(filePath, '..');
  mkdirSync(fileDir, { recursive: true });
  writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

export function cleanupTempDirs(): void {
  for (const dir of tempDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
  tempDirs = [];
}
