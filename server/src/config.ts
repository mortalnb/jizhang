import { readFileSync } from 'node:fs';

const required = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
};

const list = (value: string | undefined, fallback: string[]) =>
  value
    ?.split(',')
    .map(item => item.trim())
    .filter(Boolean) ?? fallback;

const defaultCorsOrigins = ['http://127.0.0.1:5173', 'http://localhost:5173', 'capacitor://localhost', 'http://localhost'];

const modelProvider = (name: string): 'mimo' | 'deepseek' => {
  const value = process.env[name]?.trim() || 'mimo';
  if (value !== 'mimo' && value !== 'deepseek') throw new Error(`${name} must be mimo or deepseek`);
  return value;
};
const billImageProvider = modelProvider('BILL_IMAGE_PROVIDER');
const textModelProvider = modelProvider('TEXT_MODEL_PROVIDER');

const deepseekKey = () => {
  const keyFile = process.env.DEEPSEEK_API_KEY_FILE?.trim();
  if (!keyFile) return required('DEEPSEEK_API_KEY');
  try {
    const value = readFileSync(keyFile, 'utf8').replace(/^\uFEFF/, '').trim();
    if (value) return value;
  } catch {
    // Credential contents and filesystem errors must not enter startup logs.
  }
  throw new Error('DeepSeek credential file is unavailable or empty');
};

export const config = {
  billImageProvider,
  textModelProvider,
  corsOrigin: Array.from(new Set([...defaultCorsOrigins, ...list(process.env.CORS_ORIGIN, [])])),
  defaultAllowedModels: list(process.env.DEFAULT_ALLOWED_MODELS, ['mimo-v2.5', 'mimo-v2.5-asr']),
  defaultDailyLimit: Number(process.env.DEFAULT_DAILY_LIMIT || 100),
  defaultMonthlyLimit: Number(process.env.DEFAULT_MONTHLY_LIMIT || 3000),
  deepseekApiKey: billImageProvider === 'deepseek' || textModelProvider === 'deepseek' ? deepseekKey() : undefined,
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: required('JWT_SECRET'),
  mimoApiKey: required('MIMO_API_KEY'),
  port: Number(process.env.PORT || 3000),
};
