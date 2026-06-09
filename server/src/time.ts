export const startOfToday = () => {
  const value = new Date();
  value.setHours(0, 0, 0, 0);
  return value;
};

export const startOfMonth = () => {
  const value = new Date();
  value.setDate(1);
  value.setHours(0, 0, 0, 0);
  return value;
};

export const addDays = (days: number) => {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value;
};
