import { config } from './config.js';
import { prisma } from './db.js';
import { hashPassword } from './security.js';
import { startOfMonth, startOfToday } from './time.js';

const args = process.argv.slice(2);
const command = args[0];

const option = (name: string) => {
  const prefix = `--${name}=`;
  const inline = args.find(item => item.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
};

const positional = (index: number) => args[index + 1];

const requireValue = (value: string | undefined, label: string) => {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
};

const main = async () => {
  if (command === 'create-user') {
    const username = requireValue(positional(0), 'username');
    const password = option('password') || Math.random().toString(36).slice(2, 10);
    const user = await prisma.user.create({
      data: {
        username,
        passwordHash: await hashPassword(password),
        displayName: option('display-name') || username,
        entitlement: {
          create: {
            allowedModels: config.defaultAllowedModels,
            canUseModelProxy: false,
            dailyLimit: config.defaultDailyLimit,
            monthlyLimit: config.defaultMonthlyLimit,
          },
        },
      },
    });
    console.log(`created user ${user.username}`);
    console.log(`initial password: ${password}`);
    return;
  }

  if (command === 'set-password') {
    const username = requireValue(positional(0), 'username');
    const password = requireValue(option('password') || positional(1), 'password');
    await prisma.user.update({ where: { username }, data: { passwordHash: await hashPassword(password) } });
    console.log(`updated password for ${username}`);
    return;
  }

  if (command === 'grant-model') {
    const username = requireValue(positional(0), 'username');
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const daily = Number(option('daily') || config.defaultDailyLimit);
    const monthly = Number(option('monthly') || config.defaultMonthlyLimit);
    const models = (option('models') || config.defaultAllowedModels.join(',')).split(',').map(item => item.trim()).filter(Boolean);
    await prisma.userEntitlement.upsert({
      where: { userId: user.id },
      create: { userId: user.id, canUseModelProxy: true, dailyLimit: daily, monthlyLimit: monthly, allowedModels: models },
      update: { canUseModelProxy: true, dailyLimit: daily, monthlyLimit: monthly, allowedModels: models },
    });
    console.log(`granted ${username}: daily=${daily}, monthly=${monthly}, models=${models.join(',')}`);
    return;
  }

  if (command === 'unbind-device') {
    const username = requireValue(positional(0), 'username');
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    await prisma.$transaction([
      prisma.authSession.deleteMany({ where: { userId: user.id } }),
      prisma.deviceBinding.deleteMany({ where: { userId: user.id } }),
    ]);
    console.log(`unbound device for ${username}`);
    return;
  }

  if (command === 'disable-user') {
    const username = requireValue(positional(0), 'username');
    const user = await prisma.user.update({ where: { username }, data: { isEnabled: false } });
    await prisma.authSession.deleteMany({ where: { userId: user.id } });
    console.log(`disabled ${username}`);
    return;
  }

  if (command === 'usage') {
    const username = requireValue(positional(0), 'username');
    const user = await prisma.user.findUniqueOrThrow({ where: { username } });
    const [today, month, recent] = await Promise.all([
      prisma.usageEvent.aggregate({ _sum: { costUnits: true }, where: { userId: user.id, success: true, createdAt: { gte: startOfToday() } } }),
      prisma.usageEvent.aggregate({ _sum: { costUnits: true }, where: { userId: user.id, success: true, createdAt: { gte: startOfMonth() } } }),
      prisma.usageEvent.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    console.log(JSON.stringify({ today: today._sum.costUnits ?? 0, month: month._sum.costUnits ?? 0, recent }, null, 2));
    return;
  }

  console.error(`Unknown command: ${command ?? '(none)'}`);
  console.error('Commands: create-user, set-password, grant-model, unbind-device, disable-user, usage');
  process.exitCode = 1;
};

try {
  await main();
} finally {
  await prisma.$disconnect();
}
