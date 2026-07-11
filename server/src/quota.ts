import { prisma } from './db.js';
import { AppError } from './errors.js';
import { startOfMonth, startOfToday } from './time.js';

export const assertModelAccess = async (userId: string, model: string, endpoint: string) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { entitlement: true } });
  if (!user || !user.isEnabled) throw new AppError(403, 'user_disabled', 'User is disabled');
  const entitlement = user.entitlement;
  if (!entitlement?.canUseModelProxy) throw new AppError(403, 'model_not_authorized', 'Model proxy is not enabled for this account');
  if (entitlement.expiresAt && entitlement.expiresAt <= new Date()) throw new AppError(403, 'entitlement_expired', 'Model entitlement expired');
  if (!entitlement.allowedModels.includes(model)) throw new AppError(403, 'model_not_allowed', 'This model is not allowed for this account');

  const [dailyUsage, monthlyUsage, minuteUsage] = await Promise.all([
    prisma.usageEvent.aggregate({
      _sum: { costUnits: true },
      where: { userId, success: true, createdAt: { gte: startOfToday() } },
    }),
    prisma.usageEvent.aggregate({
      _sum: { costUnits: true },
      where: { userId, success: true, createdAt: { gte: startOfMonth() } },
    }),
    prisma.usageEvent.count({
      where: { userId, endpoint, createdAt: { gte: new Date(Date.now() - 60_000) } },
    }),
  ]);

  if (minuteUsage >= 10) throw new AppError(429, 'rate_limited', 'Too many model requests');
  if ((dailyUsage._sum.costUnits ?? 0) >= entitlement.dailyLimit) throw new AppError(429, 'daily_quota_exceeded', 'Daily model quota exceeded');
  if ((monthlyUsage._sum.costUnits ?? 0) >= entitlement.monthlyLimit) throw new AppError(429, 'monthly_quota_exceeded', 'Monthly model quota exceeded');

  return {
    dailyLimit: entitlement.dailyLimit,
    dailyUsed: dailyUsage._sum.costUnits ?? 0,
    monthlyLimit: entitlement.monthlyLimit,
    monthlyUsed: monthlyUsage._sum.costUnits ?? 0,
  };
};

export const recordUsage = (input: { durationMs: number; endpoint: string; errorCode?: string; model: string; success: boolean; userId: string }) =>
  prisma.usageEvent.create({
    data: {
      costUnits: input.success ? 1 : 0,
      endpoint: input.endpoint,
      errorCode: input.errorCode,
      durationMs: input.durationMs,
      model: input.model,
      success: input.success,
      userId: input.userId,
    },
  });
