// 纯函数：平台规则、标题字数计算、广告法极限词处理、提示词构造与回复解析。
import { extractJson, pick, toStringList } from './common';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };

export interface Platform {
  id: string;
  label: string;
  /** 标题字数上限；0 表示不确定，由用户自己填 */
  limit: number;
  /** half：英文、数字、半角符号算半个字（淘宝按 60 个字符 = 30 个汉字计）；full：每个字符都算 1 个 */
  count: 'half' | 'full';
  /** 写给模型的平台风格提示（只是写法建议，不是平台规则） */
  style: string;
}

// 只写有把握的字数上限：淘宝/天猫商品标题 30 个汉字（60 个字符），小红书笔记标题 20 个字。
// 其他平台的上限经常调整，留给用户按商家后台提示自己填。
export const PLATFORMS: Platform[] = [
  { id: 'taobao', label: '淘宝 / 天猫', limit: 30, count: 'half', style: '搜索型标题：核心词 + 属性词（材质、规格、功能）+ 人群或场景词，关键词紧凑排列，少用标点' },
  { id: 'pdd', label: '拼多多', limit: 0, count: 'half', style: '突出实惠和规格数量（如几件装、多少克），用词直白，买家一眼看懂' },
  { id: 'douyin', label: '抖音商城', limit: 0, count: 'half', style: '口语化，突出使用场景和痛点，读起来顺口' },
  { id: 'xhs', label: '小红书笔记', limit: 20, count: 'full', style: '种草口吻，像真实用户分享，有情绪和画面感，可以用一个表情符号' },
  { id: 'jd', label: '京东', limit: 0, count: 'half', style: '规范清晰：品牌 + 品名 + 型号或关键参数 + 规格' },
  { id: 'general', label: '通用', limit: 0, count: 'half', style: '清晰简洁，突出核心卖点' },
];

export const platformOf = (id: string) => PLATFORMS.find((p) => p.id === id) ?? PLATFORMS[PLATFORMS.length - 1];

/** 实际生效的字数上限：用户填了就用用户的，否则用平台默认（可能是 0 = 不检查） */
export const effectiveLimit = (p: Platform, userLimit: number) => (userLimit > 0 ? userLimit : p.limit);

/** 标题字数：汉字和全角字符算 1，英文、数字、半角符号按 half 规则算 0.5 */
export function titleLength(s: string, count: Platform['count']): number {
  let n = 0;
  for (const ch of s) n += count === 'half' && ch.charCodeAt(0) <= 0x7f ? 0.5 : 1;
  return n;
}

/**
 * 广告法常见极限用语（不完整，只做提醒和自动去掉）。按长度从长到短排列，先匹配长的。
 * 依据《广告法》第九条「不得使用国家级、最高级、最佳等用语」及常见执法口径整理。
 */
export const BANNED_WORDS = [
  '全网第一', '销量第一', '排名第一', '全国第一', '行业第一', '史无前例', '独一无二', '绝无仅有', '国家级', '世界级', '全球级',
  '最高级', '最低价', '最便宜', '最先进', '最优秀', '最好', '最佳', '最强', '最高', '最低', '最大', '最新', '最热', '最火',
  '第一品牌', '第一', '顶级', '顶尖', '极致', '极品', '唯一', '首个', '首选', '首家', '万能', '100%', '百分百', '绝对', '永久', '王牌', '冠军', '领导品牌', '根治', '特效', '最',
].sort((a, b) => b.length - a.length);

/** 找出文本里的极限词（去重） */
export function findBanned(s: string): string[] {
  const hit: string[] = [];
  let rest = s;
  for (const w of BANNED_WORDS) {
    if (rest.includes(w)) {
      hit.push(w);
      rest = rest.split(w).join(' ');
    }
  }
  return hit;
}

/** 去掉极限词，并收拾多出来的空格和开头结尾的标点 */
export function stripBanned(s: string): { text: string; removed: string[] } {
  const removed = findBanned(s);
  let text = s;
  for (const w of removed) text = text.split(w).join('');
  text = text.replace(/[ \t]{2,}/g, ' ').replace(/^[\s,，、。!！|｜/]+|[\s,，、|｜/]+$/g, '').trim();
  return { text, removed };
}

export interface Product {
  /** 表格里的行号（从 2 开始，含表头那一行） */
  line: number;
  name: string;
  /** 其他参考信息：[表头, 值] */
  info: [string, string][];
}

export interface GenOptions {
  platform: Platform;
  limit: number;
  titleCount: number;
  pointCount: number;
  extra: string;
}

export const SYSTEM_PROMPT = `你是资深电商运营，擅长写商品标题和卖点。要求：
1. 只根据给出的商品信息写，不编造参数、功效、认证、销量、排名。
2. 不使用广告法禁止的极限用语，例如：最、第一、国家级、世界级、顶级、极致、唯一、首选、100%、绝对、万能、永久、根治。
3. 不写医疗功效，不承诺效果。
4. 只输出 JSON，不要任何解释。`;

/** 构造一条商品的生成请求 */
export function buildMessages(p: Product, o: GenOptions): ChatMessage[] {
  const info = p.info.filter(([, v]) => v).map(([k, v]) => `${k}：${v.slice(0, 200)}`).join('\n');
  const lenRule = o.limit > 0
    ? `每个标题不超过 ${o.limit} 个字${o.platform.count === 'half' ? '（英文和数字算半个字）' : ''}，尽量用足但不要超`
    : '标题长度适中，一般 15～30 个字';
  const user = `平台：${o.platform.label}
写法：${o.platform.style}
标题：写 ${o.titleCount} 个，角度各不相同；${lenRule}。
卖点：写 ${o.pointCount} 条，每条 8～20 个字，具体、可感知，不要空话。${o.extra ? `\n补充要求：${o.extra.slice(0, 300)}` : ''}

商品名：${p.name}
${info || '（没有其他信息）'}

按这个格式输出：{"titles": ["标题1", "标题2"], "points": ["卖点1", "卖点2"]}`;
  return [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user }];
}

export interface Generated {
  titles: string[];
  points: string[];
}

/** 解析模型回复：兼容代码块、多余文字、中文键名、字段缺失；没有标题时报错 */
export function parseReply(text: string): Generated {
  let data: unknown;
  try {
    data = extractJson(text);
  } catch {
    // 模型没按 JSON 回：把每行当一个标题（至少能用）
    const lines = toStringList(String(text)).filter((l) => !/[{}]/.test(l) && l.length <= 60);
    if (!lines.length) throw new Error('大模型返回的内容无法识别');
    return { titles: lines, points: [] };
  }
  const root = Array.isArray(data) ? data[0] : data;
  const titles = toStringList(pick(root, ['titles', 'title', '标题', 'headlines']));
  const points = toStringList(pick(root, ['points', 'sellingPoints', 'selling_points', '卖点', 'features']));
  if (!titles.length) throw new Error('大模型没有返回标题');
  return { titles, points };
}

export interface Finished {
  titles: { text: string; length: number; over: boolean }[];
  points: string[];
  notes: string[];
}

/** 收尾：去掉极限词、截到要求的条数、算字数、标记超长 */
export function finish(g: Generated, o: GenOptions): Finished {
  const removed = new Set<string>();
  const clean = (s: string) => {
    const r = stripBanned(s);
    r.removed.forEach((w) => removed.add(w));
    return r.text;
  };
  const titles = [...new Set(g.titles.map(clean).filter(Boolean))].slice(0, o.titleCount).map((text) => {
    const length = titleLength(text, o.platform.count);
    return { text, length, over: o.limit > 0 && length > o.limit };
  });
  const points = g.points.map(clean).filter(Boolean).slice(0, o.pointCount);
  const notes: string[] = [];
  const over = titles.filter((t) => t.over).length;
  if (over) notes.push(`${over} 个标题超过 ${o.limit} 字`);
  if (titles.length < o.titleCount) notes.push(`只生成了 ${titles.length} 个标题`);
  if (points.length < Math.min(3, o.pointCount)) notes.push(`卖点只有 ${points.length} 条`);
  if (removed.size) notes.push(`已去掉极限词：${[...removed].join('、')}`);
  return { titles, points, notes };
}

/** 从一行表格数据得到商品：商品名列 + 参考列（没指定就用除商品名外的所有列） */
export function rowToProduct(line: number, header: string[], row: string[], nameCol: number, infoCols: number[]): Product {
  const cols = infoCols.length ? infoCols : header.map((_, i) => i).filter((i) => i !== nameCol);
  return { line, name: row[nameCol] ?? '', info: cols.filter((i) => i !== nameCol).map((i) => [header[i], row[i] ?? ''] as [string, string]) };
}

/** 生成列的表头 */
export const outputHeader = (titleCount: number) => [...Array.from({ length: titleCount }, (_, i) => `标题${i + 1}`), '卖点', '提示'];

/** 一个商品的生成列；失败时标题留空、提示写原因 */
export function outputCells(r: Finished | { error: string }, titleCount: number): string[] {
  if ('error' in r) return [...Array(titleCount).fill(''), '', `生成失败：${r.error}`];
  return [...Array.from({ length: titleCount }, (_, i) => r.titles[i]?.text ?? ''), r.points.map((p, i) => `${i + 1}. ${p}`).join('\n'), r.notes.join('；')];
}

/** 结果区里显示的文字（每个商品一段） */
export function previewText(name: string, r: Finished | { error: string }, limit: number): string {
  if ('error' in r) return `【${name}】生成失败：${r.error}`;
  const t = r.titles.map((x, i) => `${i + 1}. ${x.text}（${x.length} 字${x.over ? `，超过 ${limit} 字` : ''}）`).join('\n');
  return `【${name}】\n${t}\n卖点：${r.points.join(' / ')}${r.notes.length ? `\n提示：${r.notes.join('；')}` : ''}`;
}
