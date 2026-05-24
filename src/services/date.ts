export const todayISO = () => new Date().toISOString().slice(0, 10);

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
