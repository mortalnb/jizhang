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

export const config = {
  corsOrigin: Array.from(new Set([...defaultCorsOrigins, ...list(process.env.CORS_ORIGIN, [])])),
  defaultAllowedModels: list(process.env.DEFAULT_ALLOWED_MODELS, ['mimo-v2.5', 'mimo-v2.5-asr']),
  defaultDailyLimit: Number(process.env.DEFAULT_DAILY_LIMIT || 100),
  defaultMonthlyLimit: Number(process.env.DEFAULT_MONTHLY_LIMIT || 3000),
  host: process.env.HOST || '0.0.0.0',
  jwtSecret: required('JWT_SECRET'),
  mimoApiKey: required('MIMO_API_KEY'),
  port: Number(process.env.PORT || 3000),
};
