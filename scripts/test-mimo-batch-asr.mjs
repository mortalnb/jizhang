import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';
import { readMimoApiKey } from './local-paths.mjs';

const apiKey = readMimoApiKey();
const categories = ['餐费', '饮料', '零食', '水果', '交通', '娱乐', '日用', '服饰', '数码', 'AI服务', '人情', '医疗', '交费', '维修', '其他'];

const vite = await createServer({ appType: 'custom', logLevel: 'error', server: { middlewareMode: true } });
const { buildTransactionPrompt, normalizeModelBatch } = await vite.ssrLoadModule('/server/src/modelContracts.ts');

const modelContent = payload => {
  const value = payload?.choices?.[0]?.message?.content ?? payload?.choices?.[0]?.message?.reasoning_content ?? '';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(item => item?.text ?? '').join('');
  return String(value);
};

const call = async body => {
  const response = await fetch('https://api.xiaomimimo.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  assert.equal(response.ok, true, `MiMo request failed with HTTP ${response.status}`);
  return response.json();
};

try {
  const prompt = buildTransactionPrompt(categories, '2026-08-09');
  const cases = [
    {
      name: 'different dates',
      text: '2026年8月1日买咖啡18元，支付宝支付。2026年8月2日坐地铁3元，微信支付。',
      verify: batch => {
        assert.equal(batch.transactions.length, 2);
        assert.deepEqual(batch.transactions.map(item => item.date), ['2026-08-01', '2026-08-02']);
      },
    },
    {
      name: 'one Walmart checkout',
      text: '2026年8月3日在沃尔玛同一次结账买纸巾20元、牛奶18元，优惠后实付35元。',
      verify: batch => {
        assert.equal(batch.transactions.length, 1);
        assert.equal(batch.transactions[0].amount, 35);
        assert.ok(batch.transactions[0].splitItems?.length >= 2);
      },
    },
    {
      name: 'separate Taobao orders',
      text: '淘宝订单A：2026年8月4日买拖鞋59元；淘宝订单B：2026年8月6日买检测服务29.99元。',
      verify: batch => assert.equal(batch.transactions.length, 2),
    },
  ];

  for (const testCase of cases) {
    const payload = await call({
      model: 'mimo-v2.5', temperature: 0.1, max_completion_tokens: 4096,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: prompt }, { role: 'user', content: testCase.text }],
    });
    const content = modelContent(payload).replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const batch = normalizeModelBatch(JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1)), categories);
    testCase.verify(batch);
    console.log(`${testCase.name}: ${batch.transactions.length} transaction(s)`);
  }

  const audioPath = process.argv[2];
  if (!audioPath) {
    console.log('ASR live test skipped: pass a WAV/MP3 path as the first argument.');
  } else {
    const bytes = fs.readFileSync(audioPath);
    assert.ok(bytes.length > 44 && bytes.length < 7_400_000, 'audio test file must fit the 10 MB base64 limit');
    const extension = path.extname(audioPath).toLowerCase();
    const mime = extension === '.mp3' ? 'audio/mpeg' : 'audio/wav';
    const payload = await call({
      model: 'mimo-v2.5-asr',
      messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: `data:${mime};base64,${bytes.toString('base64')}` } }] }],
      asr_options: { language: 'zh' },
    });
    const transcript = modelContent(payload).trim();
    assert.ok(transcript.length >= 3, 'MiMo ASR should return a non-empty transcript');
    console.log(`ASR transcript: ${transcript}`);
  }
} finally {
  await vite.close();
}
