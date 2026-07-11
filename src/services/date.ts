const chinaParts = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);

export const todayISO = () => {
  const parts = Object.fromEntries(chinaParts().map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

export const monthKey = (date: string) => date.slice(0, 7);

export const formatShortDate = (date: string) => {
  const today = todayISO();
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = yesterdayDate.toISOString().slice(0, 10);

  if (date === today) return '今天';
  if (date === yesterday) return '昨天';

  const [, month, day] = date.split('-');
  return `${Number(month)}月${Number(day)}日`;
};
