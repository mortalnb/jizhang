import { AppSettings, Transaction } from './db';

export interface SplitItem {
  amount: number;
  category: string;
  description: string;
  tag?: string;
}

export interface ParsedTransaction {
  amount: number;
  category: string;
  paymentMethod: string;
  description: string;
  date: string; // YYYY-MM-DD
  tag?: string;
  splitItems?: SplitItem[]; // 支持大模型智能拆单列表
}

// 统一导出分类的 Emoji 图标映射
export const CATEGORY_EMOJIS: Record<string, string> = {
  餐饮: '🍔',
  交通: '🚗',
  娱乐: '🎮',
  日用: '🧼',
  服饰: '👕',
  数码: '💻',
  人情: '🎁',
  医疗: '🏥',
  其他: '🪙',
  加油: '⛽',
  补给: '🔋',
  盒马: '🛒',
  理财: '📈',
  房租: '🏠',
};

// 统一导出分类的 渐变底色/边框映射
export const CATEGORY_COLORS: Record<string, string> = {
  餐饮: 'from-orange-500/20 to-amber-500/20 text-orange-400 border-orange-500/30',
  交通: 'from-blue-500/20 to-cyan-500/20 text-blue-400 border-blue-500/30',
  娱乐: 'from-purple-500/20 to-pink-500/20 text-purple-400 border-purple-500/30',
  日用: 'from-emerald-500/20 to-teal-500/20 text-emerald-400 border-emerald-500/30',
  服饰: 'from-pink-500/20 to-rose-500/20 text-pink-400 border-pink-500/30',
  数码: 'from-indigo-500/20 to-violet-500/20 text-indigo-400 border-indigo-500/30',
  人情: 'from-red-500/20 to-orange-500/20 text-red-400 border-red-500/30',
  医疗: 'from-teal-500/20 to-cyan-500/20 text-teal-400 border-teal-500/30',
  其他: 'from-gray-500/20 to-slate-500/20 text-gray-400 border-gray-500/30',
  加油: 'from-amber-500/20 to-yellow-500/20 text-yellow-400 border-yellow-500/30',
  补给: 'from-teal-500/20 to-emerald-500/20 text-teal-400 border-teal-500/30',
  盒马: 'from-blue-500/20 to-indigo-500/20 text-blue-400 border-blue-500/30',
  理财: 'from-emerald-500/20 to-green-500/20 text-emerald-400 border-emerald-500/30',
  房租: 'from-amber-500/20 to-orange-500/20 text-amber-400 border-amber-500/30',
};

// 获取分类 Emoji（带兜底）
export const getCategoryEmoji = (cat: string): string => {
  if (CATEGORY_EMOJIS[cat]) return CATEGORY_EMOJIS[cat];
  for (const [k, v] of Object.entries(CATEGORY_EMOJIS)) {
    if (cat.includes(k) || k.includes(cat)) return v;
  }
  return '🪙';
};

// 获取分类渐变色（带兜底）
export const getCategoryColor = (cat: string): string => {
  if (CATEGORY_COLORS[cat]) return CATEGORY_COLORS[cat];
  for (const [k, v] of Object.entries(CATEGORY_COLORS)) {
    if (cat.includes(k) || k.includes(cat)) return v;
  }
  return 'from-gray-500/20 to-slate-500/20 text-gray-400 border-gray-500/30';
};

// 本地高级解析引擎：支持防年份干扰、过滤单价与实付款重复项、高精度账单扫描多物品匹配与“智能拆单”自动加和！
const localMockParse = (text: string, categories: string[]): ParsedTransaction => {
  const todayStr = new Date('2026-05-23').toISOString().split('T')[0];
  
  // A. 智能判定场景标签 (#盒马周购 vs #淘宝网购)
  let tag: string | undefined = undefined;
  if (text.includes('盒马') || text.includes('周购') || text.includes('每周') || text.includes('补给')) {
    tag = '#盒马周购';
  } else if (text.includes('淘宝') || text.includes('天猫') || text.includes('极客') || text.includes('turnitin') || text.includes('实付款')) {
    tag = '#淘宝网购';
  } else if (text.includes('加油') || text.includes('充值') || text.includes('汽油')) {
    tag = '#加油';
  }

  // --- 1. 高级多行账单/截图文字扫描引擎 ---
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const itemsDetected: Array<{ name: string; price: number }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    // 跳过单价规格干扰，同时强力跳过“实付款”和“应付款”等汇总行
    if (line.includes('单价') || 
        line.includes('原价') || 
        line.includes('/') || 
        line.includes('规格') || 
        line.includes('实付款') || 
        line.includes('应付款') || 
        line.includes('实付') || 
        line.includes('合计')) {
      continue;
    }
    
    // 寻找价格特征：
    // 1. 优先匹配以 ¥ 或 ￥ 开头的价格数字（可带1-2位小数）
    // 2. 如果整行就是一个单纯的价格数字（如 59 或 29.99），也匹配它
    // 这能够完美排除长句描述中的尺寸（如43码）、退换政策（如7天）、数量（如x1）等杂音
    let priceMatch = line.match(/[¥￥]\s*(\d+(?:\.\d{1,2})?)/);
    if (!priceMatch) {
      const pureNumberMatch = line.match(/^\s*(\d+(?:\.\d{1,2})?)\s*$/);
      if (pureNumberMatch) {
        priceMatch = [line, pureNumberMatch[1]];
      }
    }

    if (priceMatch) {
      const price = parseFloat(priceMatch[1]);
      
      // 安全过滤：排除大数干扰和年份干扰
      let isValidPrice = price > 0 && price < 1500;
      if (price === 2026 || price === 2025 || price === 2024) {
        // 如果数字恰好是年份，必须包含货币符号前缀才被认为是有效价格，否则判定为年份行过滤掉
        if (!priceMatch[0].includes('¥') && !priceMatch[0].includes('￥')) {
          isValidPrice = false;
        }
      }

      if (isValidPrice) {
        let itemName = '';
        
        // 尝试从当前行价格前面提取商品名
        const namePart = line.split(priceMatch[0])[0].trim();
        if (namePart && namePart.length > 1 && !namePart.startsWith('单价') && !namePart.startsWith('原价') && !namePart.includes('日期')) {
          itemName = namePart;
        } else {
          // 向上查找前6行找到最真实的商品名称行！
          for (let j = i - 1; j >= Math.max(0, i - 6); j--) {
            const prevLine = lines[j];
            
            // 过滤无意义的行（跳过纯数量、已发货头部、天猫超市/订单头部等）
            const isQuantityLine = prevLine.match(/^\d+\s*(?:盒|袋|瓶|个|只|包|支|杯|双|件)$/) || 
                                   prevLine.match(/^x\d+$/) ||
                                   prevLine.endsWith('盒') || 
                                   prevLine.endsWith('袋') || 
                                   prevLine.endsWith('瓶') || 
                                   prevLine.endsWith('杯') ||
                                   prevLine.endsWith('双') ||
                                   prevLine.endsWith('件') ||
                                   prevLine.includes('已发货') ||
                                   prevLine.includes('官方店铺') ||
                                   prevLine.includes('天猫超市') ||
                                   prevLine.includes('全部订单');

            if (prevLine.length > 2 && 
                !prevLine.includes('¥') && 
                !prevLine.includes('￥') && 
                !prevLine.includes('规格') && 
                !prevLine.includes('单价') && 
                !prevLine.includes('日期') && 
                !prevLine.includes('完成') &&
                !prevLine.includes('实付款') &&
                !isQuantityLine) {
              itemName = prevLine;
              break;
            }
          }
        }
        
        // 清洗名字
        itemName = itemName.replace(/[¥￥\d\.]/g, '').trim();
        if (itemName.length > 15) {
          itemName = itemName.substring(0, 15) + '...';
        }
        
        if (itemName && itemName !== '商品支出') {
          if (!itemsDetected.some(x => x.name === itemName)) {
            itemsDetected.push({ name: itemName, price });
          }
        }
      }
    }
  }

  // 如果扫描到了多个有效的明细子项，自动触发高保真的“智能拆单”！
  if (itemsDetected.length > 1) {
    const splitItems: SplitItem[] = itemsDetected.map(item => {
      let cat = '其他';
      const nameLower = item.name.toLowerCase();
      
      if (nameLower.includes('洗发') || nameLower.includes('发水') || nameLower.includes('纸') || nameLower.includes('日用') || nameLower.includes('洗') || nameLower.includes('洁') || nameLower.includes('沐浴')) {
        cat = categories.includes('日用') ? '日用' : categories[0];
      } else if (nameLower.includes('虾') || nameLower.includes('蛋') || nameLower.includes('提') || nameLower.includes('冰') || nameLower.includes('咖啡') || nameLower.includes('餐') || nameLower.includes('面') || nameLower.includes('零食') || nameLower.includes('奶') || nameLower.includes('肉') || nameLower.includes('heineken') || nameLower.includes('啤酒') || nameLower.includes('喜力')) {
        cat = categories.includes('餐饮') ? '餐饮' : categories[0];
      } else if (nameLower.includes('鞋') || nameLower.includes('拖鞋') || nameLower.includes('凉拖') || nameLower.includes('衣') || nameLower.includes('裤') || nameLower.includes('帽') || nameLower.includes('袜')) {
        cat = categories.includes('服饰') ? '服饰' : categories[0];
      }
      
      return {
        amount: item.price,
        category: cat,
        description: item.name,
        tag,
      };
    });

    // 修复浮点数求和时的微量偏差精度噪音（例如 144.48000000000002）
    const totalAmount = parseFloat(splitItems.reduce((sum, item) => sum + item.amount, 0).toFixed(2));

    return {
      amount: totalAmount,
      category: categories.includes('日用') ? '日用' : categories[0],
      paymentMethod: '支付宝',
      description: '淘宝智能导入账单(已自动拆单)',
      date: todayStr,
      tag,
      splitItems,
    };
  }

  // --- 2. 传统语法分析降级 ---
  if (text.includes('其中') && (text.includes('，') || text.includes(' '))) {
    const totalMatch = text.match(/花了\s*(\d+(\.\d+)?)/) || text.match(/(\d+(\.\d+)?)/);
    const totalAmount = totalMatch ? parseFloat(totalMatch[1]) : 150;
    
    const parts = text.split('其中')[1].split(/[，,;；\s]/).filter(p => p.trim().length > 0);
    const splitItems: SplitItem[] = [];
    
    parts.forEach(part => {
      const numMatch = part.match(/(\d+(\.\d+)?)/);
      if (numMatch) {
        const amt = parseFloat(numMatch[1]);
        const name = part.replace(numMatch[1], '').trim();
        
        let cat = '其他';
        if (name.includes('面') || name.includes('吃') || name.includes('零食') || name.includes('奶') || name.includes('肉')) {
          cat = categories.includes('餐饮') ? '餐饮' : categories[0];
        } else if (name.includes('纸') || name.includes('洗') || name.includes('日用') || name.includes('洁')) {
          cat = categories.includes('日用') ? '日用' : categories[0];
        }
        
        splitItems.push({
          amount: amt,
          category: cat,
          description: name,
          tag,
        });
      }
    });

    if (splitItems.length > 0) {
      return {
        amount: totalAmount,
        category: categories.includes('日用') ? '日用' : categories[0],
        paymentMethod: text.includes('支付宝') ? '支付宝' : '微信支付',
        description: '混合消费(已智能拆单)',
        date: todayStr,
        tag,
        splitItems,
      };
    }
  }

  // --- 3. 常规单笔提取 ---
  let amount = 0;
  
  const allNumberMatches = Array.from(text.matchAll(/(?:[¥￥]\s*)?(\d+(?:\.\d+)?)/g));
  for (const match of allNumberMatches) {
    const val = parseFloat(match[1]);
    
    if (val === 2026 || val === 2025 || val === 2024) {
      if (!match[0].includes('¥') && !match[0].includes('￥')) {
        continue;
      }
    }
    
    amount = val;
    break;
  }
  
  let category = categories[categories.length - 1] || '其他';
  for (const cat of categories) {
    if (text.includes(cat)) {
      category = cat;
      break;
    }
  }
  
  if (category === 'other' || category === '其他' || !category) {
    if (text.includes('吃') || text.includes('饭') || text.includes('麦当劳') || text.includes('火锅') || text.includes('面包')) {
      category = categories.includes('餐饮') ? '餐饮' : categories[0];
    } else if (text.includes('车') || text.includes('地铁') || text.includes('打车') || text.includes('加油')) {
      category = categories.includes('交通') ? '交通' : categories[0];
    } else if (text.includes('超市') || text.includes('买菜') || text.includes('盒马') || text.includes('洗')) {
      category = categories.includes('日用') ? '日用' : categories[0];
    }
  }

  let paymentMethod = '微信支付';
  if (text.includes('微信')) paymentMethod = '微信支付';
  else if (text.includes('支付宝') || text.includes('花呗')) paymentMethod = '支付宝';

  let description = text.replace(/花了|支付了|微信|支付宝|现金/g, '').trim();
  if (description.length > 15) description = description.substring(0, 15) + '...';
  if (!description) description = `${category}支出`;

  return {
    amount,
    category,
    paymentMethod,
    description,
    date: todayStr,
    tag,
  };
};

export const aiService = {
  async parseTransaction(text: string, settings: AppSettings): Promise<ParsedTransaction> {
    const categoriesList = settings.categories && settings.categories.length > 0 
      ? settings.categories 
      : ['餐饮', '交通', '娱乐', '日用', '服饰', '数码', '人情', '医疗', '其他'];

    if (!settings.apiKey || settings.apiKey.trim() === '') {
      await new Promise(resolve => setTimeout(resolve, 1500));
      return localMockParse(text, categoriesList);
    }

    const todayStr = new Date('2026-05-23').toISOString().split('T')[0];
    const systemPrompt = `你是一个专业的记账财务助手。你的任务是从用户的日常记账描述或OCR账单识别文本中提取结构化财务数据。

你必须根据用户自定义的以下分类列表对交易进行归类：
分类列表: [${categoriesList.map(c => `'${c}'`).join(', ')}]

你要提取以下核心字段：
1. amount: 支出总金额，数值型，必须为正数（例如：150）。如果有多笔明细，它必须是所有明细金额的总和！
   **注意**：你必须仔细识别并过滤文本中的年份（例如 2026、2025、2024）和“实付款 ¥59”等汇总重复价格，绝对不能重复计算或把年份误识别为总金额！
2. category: 交易大类。必须属于上述【分类列表】中的一个，绝对不能自己发明分类！如果不好分类，归到“其他”或列表中的兜底项。
3. paymentMethod: 支付渠道，只能是：'微信支付', '支付宝', '银行卡', '现金' 之一。默认为 '微信支付'。
4. description: 支出事由精简提炼（不超过15字），例如“盒马鲜生采购”、“淘宝批量采购”。
5. date: 记账日期，格式 YYYY-MM-DD。今天是 ${todayStr}。
6. tag: 附加汇总标签（格式为#标签名），例如：
   - 只要提到“盒马”、“每周采购”、“囤货”，自动归为标签 "#盒马周购"。
   - 提到“淘宝”、“天猫”、“订单”、“购物”，自动归为标签 "#淘宝网购"。
   - 其他情境可不填，或根据用户输入提取。

【智能拆单（拆分多商品交易）】
如果文本中包含多个具体商品的名称及其价格（如多行商品列表及对应 ¥ 金额），你必须触发“智能拆单”！
把每一个商品提取为一个 splitItem 并返回在 "splitItems" 数组中：
每个 splitItem 必须包含：
- amount: 该子项金额
- category: 子项分类（必须属于上述【分类列表】。例如：啤酒/零食是“餐饮”；衣服/拖鞋/鞋是“服饰”；洗发水/纸巾是“日用”；查重/论文服务是“其他”）
- description: 子项具体描述（如“百亿补贴Heineken啤酒”、“极客鞋谈平步拖鞋”）
- tag: 统一设为标签，如 "#淘宝网购" 或 "#盒马周购"

你必须只返回一个标准的 JSON 响应，结构必须为：
{
  "amount": 所有明细相加的总金额数值,
  "category": "总分类名",
  "paymentMethod": "支付渠道",
  "description": "精炼汇总描述",
  "date": "YYYY-MM-DD",
  "tag": "#标签",
  "splitItems": [
    { "amount": 数值, "category": "分类名", "description": "子项描述", "tag": "#标签" }
  ] (如果账单包含多件商品，强制输出此项)
}

不要包含 markdown 代码块包裹，只返回 JSON。`;

    try {
      const response = await fetch(`${settings.baseUrl}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${settings.apiKey}`
        },
        body: JSON.stringify({
          model: settings.model || 'deepseek-v4-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: text }
          ],
          temperature: 0.1,
          response_format: { type: 'json_object' }
        })
      });

      if (!response.ok) {
        throw new Error(`API 访问失败: HTTP ${response.status}`);
      }

      const resData = await response.json();
      const content = resData.choices[0].message.content;
      const parsed: ParsedTransaction = JSON.parse(content);
      
      const validCategory = categoriesList.includes(parsed.category) ? parsed.category : (categoriesList[categoriesList.length - 1] || 'other');
      
      let validatedSplit: SplitItem[] | undefined = undefined;
      if (parsed.splitItems && Array.isArray(parsed.splitItems)) {
        validatedSplit = parsed.splitItems.map(item => ({
          amount: typeof item.amount === 'number' ? item.amount : 0,
          category: categoriesList.includes(item.category) ? item.category : validCategory,
          description: item.description || '拆单项目',
          tag: item.tag || parsed.tag,
        }));
      }

      const finalAmount = validatedSplit && validatedSplit.length > 0 
        ? parseFloat(validatedSplit.reduce((sum, item) => sum + item.amount, 0).toFixed(2))
        : (typeof parsed.amount === 'number' ? parsed.amount : 0);

      return {
        amount: finalAmount,
        category: validCategory,
        paymentMethod: ['微信支付', '支付宝', '银行卡', '现金'].includes(parsed.paymentMethod) ? parsed.paymentMethod : '微信支付',
        description: parsed.description || text.substring(0, 15),
        date: parsed.date || todayStr,
        tag: parsed.tag,
        splitItems: validatedSplit,
      };
      
    } catch (error) {
      console.error('DeepSeek API 解析出错，降级至本地解析器:', error);
      return localMockParse(text, categoriesList);
    }
  }
};
