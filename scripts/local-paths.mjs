import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const existingFile = candidates => candidates.find(candidate => candidate && fs.existsSync(candidate));

export const resolveMimoKeyPath = () => {
  const configured = process.env.JIZHANG_MIMO_KEY_FILE?.trim();
  const candidates = [
    configured ? path.resolve(configured) : undefined,
    path.join(projectRoot, '.local', 'credentials', 'mimo-api-key.txt'),
    path.join(projectRoot, 'key.txt'),
  ];
  return existingFile(candidates) ?? candidates[1];
};

export const readMimoApiKey = () => {
  const keyPath = resolveMimoKeyPath();
  const apiKey = fs.existsSync(keyPath) ? fs.readFileSync(keyPath, 'utf8').trim() : '';
  if (!apiKey) throw new Error('MiMo API key is missing; place it at .local/credentials/mimo-api-key.txt or set JIZHANG_MIMO_KEY_FILE.');
  return apiKey;
};
