const EMPTY_TAG = /^(?:未指定|none|null|undefined|\[\]|\{\})$/i;

const TAG_ALIASES: Record<string, string> = {
  盒马采购: '超市采购',
  盒马周购: '超市采购',
  超市周购: '超市采购',
  淘宝网购: '网购',
  网购订单: '网购',
  火车票: '火车出行',
  软件订阅: '订阅',
};

/**
 * Tags are a single optional scenario label. Legacy arrays and model-produced
 * multi-value strings are reduced deterministically instead of becoming a new
 * user-facing multi-tag system.
 */
export const normalizeScenarioTag = (tag: unknown) => {
  const candidates = (Array.isArray(tag) ? tag : [tag])
    .filter((value): value is string => typeof value === 'string')
    .flatMap(value => value.split(/[,，;；|/]+/))
    .map(value => value.trim().replace(/^#+\s*/, ''))
    .filter(value => value && !EMPTY_TAG.test(value));
  const first = candidates[0];
  if (!first) return undefined;
  return (TAG_ALIASES[first] ?? first).slice(0, 40);
};

const merchantFromText = (text: string) => {
  if (/盒马鲜生|盒马/.test(text)) return '盒马';
  if (/沃尔玛|沃爾瑪|walmart/i.test(text)) return '沃尔玛';
  if (/山姆|sam'?s\s*club/i.test(text)) return '山姆';
  if (/天猫|天貓|tmall/i.test(text)) return '天猫';
  if (/淘宝|淘寶|taobao/i.test(text)) return '淘宝';
  if (/瑞幸|luckin/i.test(text)) return '瑞幸';
  if (/麦当劳|麥當勞|mcdonald/i.test(text)) return '麦当劳';
  return undefined;
};

export const normalizeMerchant = (input: { description?: unknown; detail?: unknown; merchant?: unknown }) => {
  const context = [input.description, input.detail]
    .filter((value): value is string => typeof value === 'string')
    .join(' ');
  const contextual = merchantFromText(context);
  const explicit = typeof input.merchant === 'string' ? input.merchant.trim() : '';
  if (!explicit || /^(?:盒马鲜生|沃尔玛\s*[/／]\s*山姆)$/.test(explicit)) return contextual ?? merchantFromText(explicit);
  return merchantFromText(explicit) ?? explicit.slice(0, 80);
};
