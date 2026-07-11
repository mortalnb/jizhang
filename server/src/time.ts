const chinaOffsetMs = 8 * 60 * 60 * 1000;
export const startOfToday = () => {
  const now = new Date();
  return new Date(Math.floor((now.getTime() + chinaOffsetMs) / 86_400_000) * 86_400_000 - chinaOffsetMs);
};

export const startOfMonth = () => {
  const now = new Date();
  const china = new Date(now.getTime() + chinaOffsetMs);
  return new Date(Date.UTC(china.getUTCFullYear(), china.getUTCMonth(), 1) - chinaOffsetMs);
};

export const addDays = (days: number) => {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value;
};
