export interface Transaction {
  id: string;
  amount: number;
  category: string;
  date: string; // YYYY-MM-DD
  paymentMethod: string;
  description: string;
  tag?: string;
}

export interface AppSettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  monthlyBudget: number;
  categories: string[]; // 新增：动态自定义大类列表
}

const DEFAULT_CATEGORIES = ['餐饮', '交通', '娱乐', '日用', '服饰', '数码', '人情', '医疗', '其他'];

const DEFAULT_SETTINGS: AppSettings = {
  apiKey: '',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  monthlyBudget: 3000,
  categories: DEFAULT_CATEGORIES,
};

// 预置初始记账数据，增加智能标签 tag (如 #盒马周购、#加油)
const generateMockData = (): Transaction[] => {
  const list: Transaction[] = [];
  const categories = [
    { name: '餐饮', method: '微信支付', desc: ['午餐麦当劳', '海底捞火锅', '星巴克咖啡', '路边摊早餐', '美团外卖点餐'] },
    { name: '交通', method: '支付宝', desc: ['地铁乘车', '网约车打车', '共享单车骑行', '加油充值'] },
    { name: '娱乐', method: '微信支付', desc: ['周末电影票', 'Switch游戏购买', '网易云音乐会员', '剧本杀聚会'] },
    { name: '日用', method: '支付宝', desc: ['天猫超市日用品', '名创优品生活杂货', '理发剪发'] },
    { name: '服饰', method: '微信支付', desc: ['优衣库T恤', '夏季短袖购买', '运动鞋正品'] },
    { name: '数码', method: '支付宝', desc: ['充电线与快充头', '蓝牙耳机保护套'] },
  ];

  const today = new Date('2026-05-23');

  const addTx = (daysAgo: number, categoryIndex: number, amount: number, descOverride?: string, tag?: string) => {
    const d = new Date(today);
    d.setDate(today.getDate() - daysAgo);
    const dateStr = d.toISOString().split('T')[0];
    const cat = categories[categoryIndex];
    const desc = descOverride || cat.desc[Math.floor(Math.random() * cat.desc.length)];
    
    list.push({
      id: Math.random().toString(36).substring(2, 9),
      amount,
      category: cat.name,
      date: dateStr,
      paymentMethod: cat.method,
      description: desc,
      tag,
    });
  };

  // --- 5月份数据 ---
  // 今天 5-23
  addTx(0, 0, 25, '麦当劳午餐');
  addTx(0, 1, 15, '打车回家');
  // 昨天 5-22 （包含一单盒马周购，餐饮与日用）
  addTx(1, 0, 89, '盒马鲜生: 面条面包与零食', '#盒马周购');
  addTx(1, 3, 61, '盒马鲜生: 纸巾洗碗精', '#盒马周购');
  addTx(1, 3, 49, '名创优品日用品');
  
  // 5月第4周 (5-17 到 5-21)
  addTx(2, 0, 18, '瑞幸咖啡');
  addTx(3, 1, 4, '地铁乘车');
  addTx(4, 2, 45, '周末电影票');
  addTx(5, 0, 32, '外卖黄焖鸡');
  // 5月第3周 (5-10 到 5-16)（包含一单盒马周购）
  addTx(7, 0, 95, '盒马鲜生: 鲜奶和牛排', '#盒马周购');
  addTx(7, 3, 40, '盒马鲜生: 垃圾袋垃圾桶', '#盒马周购');
  addTx(8, 4, 199, '优衣库T恤');
  addTx(9, 1, 38, '网约车下雨打车');
  addTx(11, 0, 15, '麻辣烫');
  // 5月第2周 (5-3 到 5-9)（包含一单盒马周购）
  addTx(14, 0, 75, '盒马鲜生: 水果蔬菜', '#盒马周购');
  addTx(14, 3, 55, '盒马鲜生: 湿纸巾洗发精', '#盒马周购');
  addTx(15, 2, 99, '游戏道具充值');
  addTx(16, 0, 56, '老乡鸡晚餐');
  // 5月第1周 (5-1 到 5-2)
  addTx(22, 0, 120, '假期聚会烧烤');

  // --- 4月份历史数据 ---
  const daysInApril = 30;
  for (let i = 0; i < 20; i++) {
    const daysAgo = 23 + Math.floor(Math.random() * daysInApril);
    const catIdx = Math.floor(Math.random() * categories.length);
    let amt = 15 + Math.floor(Math.random() * 80);
    if (catIdx === 5) amt = 150 + Math.floor(Math.random() * 200);
    if (catIdx === 4) amt = 100 + Math.floor(Math.random() * 150);
    // 4月份也加上部分盒马周购数据以保持跨月对比分析的饱满度
    const isHema = i % 5 === 0;
    addTx(daysAgo, catIdx, amt, isHema ? '盒马鲜生周度采购' : undefined, isHema ? '#盒马周购' : undefined);
  }

  // --- 3月份历史数据 ---
  for (let i = 0; i < 15; i++) {
    const daysAgo = 53 + Math.floor(Math.random() * 31);
    const catIdx = Math.floor(Math.random() * 4);
    const amt = 10 + Math.floor(Math.random() * 120);
    addTx(daysAgo, catIdx, amt);
  }

  // --- 2月份历史数据 ---
  addTx(85, 5, 899, '红米降噪耳机/智能手环');
  for (let i = 0; i < 15; i++) {
    const daysAgo = 84 + Math.floor(Math.random() * 28);
    const catIdx = Math.floor(Math.random() * 4);
    const amt = 10 + Math.floor(Math.random() * 100);
    addTx(daysAgo, catIdx, amt);
  }

  return list;
};

export const db = {
  getTransactions(): Transaction[] {
    const data = localStorage.getItem('ab_transactions');
    if (!data) {
      const mock = generateMockData();
      localStorage.setItem('ab_transactions', JSON.stringify(mock));
      return mock;
    }
    return JSON.parse(data);
  },

  saveTransaction(tx: Omit<Transaction, 'id'> & { id?: string }): Transaction {
    const list = this.getTransactions();
    const newTx: Transaction = {
      ...tx,
      id: tx.id || Math.random().toString(36).substring(2, 9),
    };
    
    const index = list.findIndex(item => item.id === newTx.id);
    if (index > -1) {
      list[index] = newTx;
    } else {
      list.unshift(newTx);
    }
    
    localStorage.setItem('ab_transactions', JSON.stringify(list));
    return newTx;
  },

  deleteTransaction(id: string): void {
    const list = this.getTransactions();
    const filtered = list.filter(item => item.id !== id);
    localStorage.setItem('ab_transactions', JSON.stringify(filtered));
  },

  getSettings(): AppSettings {
    const data = localStorage.getItem('ab_settings');
    if (!data) {
      localStorage.setItem('ab_settings', JSON.stringify(DEFAULT_SETTINGS));
      return DEFAULT_SETTINGS;
    }
    return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
  },

  saveSettings(settings: AppSettings): void {
    localStorage.setItem('ab_settings', JSON.stringify(settings));
  },
  
  resetAll(): void {
    localStorage.removeItem('ab_transactions');
    localStorage.removeItem('ab_settings');
  }
};
