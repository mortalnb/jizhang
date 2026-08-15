import assert from 'node:assert/strict';
import { readMimoApiKey } from './local-paths.mjs';

const apiKey = readMimoApiKey();

const categories = ['餐费', '饮料', '零食', '水果', '交通', '娱乐', '日用', '服饰', '数码', 'AI服务', '人情', '医疗', '交费', '维修', '其他'];
const today = new Date().toISOString().slice(0, 10);
const systemPrompt = `你是记账助手。请从用户输入中提取 JSON：amount, category, description, detail, date, tag, splitItems。不要返回 paymentMethod；splitItems 的每一项只包含 amount, category, description, detail。tag 只能是 0 或 1 个不带 # 的场景短词。category 必须属于：${categories.join(', ')}。description 必须是适合账单列表展示的凝练标题，4 到 12 个中文字符左右，不要写解释。detail 用一句稍微更详细的中文说明消费场景、归类依据或拆单依据，避免编造不存在的商户和金额。

AA 或多人分摊场景只记录用户最终承担的净支出，必须返回单笔账单，不要生成 splitItems。金额判断优先级：如果提供了用户实际付款和收到的回款，amount 等于实际付款减去回款；如果提供了实际转账金额，不得强制按人数平均；只有明确说明平均 AA 且没有提供实际回款金额时，才用总金额除以人数。
示例：“我付了 120，他转我 60”应返回 amount 60；“3 个人吃饭花了 300，是 AA 的”应返回 amount 100；“两人吃饭 163，我付的，他只转我 80”应返回 amount 83。AA 场景的 detail 应说明这是用户最终承担金额。

今天是 ${today}。只返回 JSON。`;

const cases = [
  ['今天和朋友吃饭AA，我付的，我付了120，他转了我60', 60],
  ['3个人吃饭花了300，是AA的', 100],
  ['两人吃饭总共163，我付的，他只转了我80', 83],
];

for (const [text, expectedAmount] of cases) {
  const response = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'mimo-v2.5',
      temperature: 0.1,
      max_completion_tokens: 2048,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
    }),
  });

  assert.equal(response.ok, true, `MiMo request failed with HTTP ${response.status}`);
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.message?.reasoning_content;
  const parsed = JSON.parse(String(content).replace(/```(?:json)?/gi, '').replace(/```/g, '').trim());
  assert.equal(Number(parsed.amount), expectedAmount, `${text} should return amount ${expectedAmount}`);
  assert.ok(!parsed.splitItems?.length, `${text} should not return splitItems`);
  console.log(`${text} -> ¥${Number(parsed.amount).toFixed(2)} / ${parsed.category}`);
}

const categoryCases = [
  ['买了一包薯片花了12元', '零食'],
  ['买苹果花了25元', '水果'],
  ['购买大模型 token 花了100元', 'AI服务'],
  ['订阅 ChatGPT 花了140元', 'AI服务'],
];

for (const [text, expectedCategory] of categoryCases) {
  const response = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'mimo-v2.5',
      temperature: 0.1,
      max_completion_tokens: 2048,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: text },
      ],
    }),
  });

  assert.equal(response.ok, true, `MiMo request failed with HTTP ${response.status}`);
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content || payload?.choices?.[0]?.message?.reasoning_content;
  const parsed = JSON.parse(String(content).replace(/```(?:json)?/gi, '').replace(/```/g, '').trim());
  assert.equal(parsed.category, expectedCategory, `${text} should return category ${expectedCategory}`);
  console.log(`${text} -> ${parsed.category}`);
}

console.log('Real MiMo AA verification passed.');
