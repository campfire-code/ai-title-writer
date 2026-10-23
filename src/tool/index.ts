// 工具声明：AI 标题卖点批量生成
import { Type as TypeAsIcon } from 'lucide-react';
import type { BatchTool, RunContext } from '../kit/types';
import { baseName, cellText, errText, guessColumn, isFatalLlmError, mapPool, resolveColumn, safeName, splitList, toTable } from './common';
import { PLATFORMS, buildMessages, effectiveLimit, finish, outputCells, outputHeader, parseReply, platformOf, previewText, rowToProduct, type Finished, type GenOptions, type Product } from './core';
import { readSheets, writeXlsx } from './xlsx';

const NAME_KEYWORDS = [/^商品名称?$/, /^(产品|宝贝)名称?$/, /商品名|品名|产品名|宝贝名/, /名称/, /^(商品|产品|宝贝)$/, /标题/];
const MAX_ROWS = 500;

/** 生成一个商品：解析失败重试一次；致命错误（没配置、密钥错）直接抛出 */
async function generateOne(p: Product, o: GenOptions, ctx: RunContext): Promise<Finished> {
  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const reply = await ctx.llm(buildMessages(p, o), { json: true, temperature: 0.8 });
      return finish(parseReply(reply), o);
    } catch (e) {
      if (isFatalLlmError(e)) throw e;
      last = e;
    }
  }
  throw last;
}

const tool: BatchTool = {
  id: 'e09',
  name: 'AI 标题卖点批量生成',
  tagline: '拖入商品表格，每个商品自动写好几个标题和 3～5 条卖点，导出新的 Excel。超长标题标红，自动去掉「最」「第一」等广告法极限词。',
  icon: TypeAsIcon,
  category: '电商运营',
  type: 'text',
  mode: 'batch',
  resultView: 'text',
  needsLLM: true,
  concurrency: 1,
  accept: { label: '商品表格', extensions: ['xlsx', 'csv', 'xls'] },
  params: [
    { key: 'platform', label: '发布平台', type: 'select', options: PLATFORMS.map((p) => [p.id, p.label]), default: 'taobao', help: '淘宝/天猫标题 30 字，小红书笔记 20 字，以平台规则为准' },
    { key: 'titleCount', label: '每个商品写几个标题', type: 'number', default: 3, min: 1, max: 5 },
    { key: 'pointCount', label: '每个商品写几条卖点', type: 'number', default: 4, min: 3, max: 5 },
    { key: 'limit', label: '标题字数上限', type: 'number', default: 0, min: 0, max: 100, unit: '字', help: '0 = 按平台默认；拼多多、抖音、京东请按商家后台提示填' },
    { key: 'nameCol', label: '商品名在哪一列', type: 'text', default: '', placeholder: '不填自动识别「商品名称」等列；也可以写列字母 A' },
    { key: 'infoCols', label: '参考哪些列', type: 'text', default: '', placeholder: '不填就参考其他所有列；例如：品类，卖点关键词，规格' },
    { key: 'extra', label: '补充要求', type: 'text', default: '', placeholder: '可选，例如：突出送礼、面向学生党' },
    { key: 'out', label: '保存到', type: 'folder', default: '' },
  ],
  check: (item) => (/\.xls$/i.test(item.name) ? '旧版 .xls 格式不支持，请用 Excel 或 WPS 另存为 .xlsx 后再拖进来' : null),

  async run(item, ctx) {
    const p = ctx.params;
    const sheets = await readSheets(await ctx.readFile(item.path!), item.name);
    const sheet = sheets.find((s) => s.grid.some((r) => r.length));
    if (!sheet) throw new Error('表格是空的');
    const table = toTable(sheet.grid);
    if (!table.rows.length) throw new Error('表格里只有表头，没有商品');

    const nameSpec = String(p.nameCol ?? '').trim();
    const nameCol = nameSpec ? resolveColumn(table.header, nameSpec) : guessColumn(table.header, NAME_KEYWORDS);
    const heads = `${table.header.slice(0, 12).join('、')}${table.header.length > 12 ? '…' : ''}`;
    if (nameCol < 0) throw new Error(nameSpec ? `找不到列「${nameSpec}」，表头是：${heads}` : `没认出哪一列是商品名，请在「商品名在哪一列」里填写。表头是：${heads}`);
    const infoCols: number[] = [];
    for (const name of splitList(String(p.infoCols ?? ''))) {
      const i = resolveColumn(table.header, name);
      if (i < 0) throw new Error(`「参考哪些列」里的「${name}」找不到，表头是：${heads}`);
      infoCols.push(i);
    }

    const all = table.rows.map((r, i) => ({ r, line: i + 2 })).filter(({ r }) => cellText(r[nameCol]));
    if (!all.length) throw new Error(`「${table.header[nameCol]}」这一列都是空的`);
    if (all.length > MAX_ROWS) throw new Error(`一次最多处理 ${MAX_ROWS} 个商品，这个表有 ${all.length} 个，请拆开后再处理`);

    const platform = platformOf(String(p.platform));
    const o: GenOptions = {
      platform,
      limit: effectiveLimit(platform, Number(p.limit) || 0),
      titleCount: Math.min(5, Math.max(1, Number(p.titleCount) || 3)),
      pointCount: Math.min(5, Math.max(3, Number(p.pointCount) || 4)),
      extra: String(p.extra ?? '').trim(),
    };

    let done = 0;
    const results = await mapPool(all, 3, async ({ r, line }) => {
      const prod = rowToProduct(line, table.header, r.map(cellText), nameCol, infoCols);
      let res: Finished | { error: string };
      try {
        res = await generateOne(prod, o, ctx);
      } catch (e) {
        if (isFatalLlmError(e)) throw e;
        res = { error: errText(e) };
      }
      ctx.progress(0.05 + (0.85 * ++done) / all.length);
      return { prod, row: r, res };
    }, ctx.signal);

    const failed = results.filter((x) => 'error' in x.res);
    if (failed.length === results.length) throw new Error(`全部生成失败：${(failed[0].res as { error: string }).error}`);

    // 原列 + 生成列；超长标题标红
    const extraHead = outputHeader(o.titleCount);
    const base = table.header.length;
    const red = new Set<string>();
    const rows = results.map((x, ri) => {
      if (!('error' in x.res)) x.res.titles.forEach((t, ti) => t.over && red.add(`${ri},${base + ti}`));
      else red.add(`${ri},${base + o.titleCount + 1}`);
      return [...x.row, ...outputCells(x.res, o.titleCount)];
    });
    const out = await ctx.join(ctx.outputDir, `${safeName(baseName(item.name))}-标题卖点.xlsx`);
    await ctx.writeFile(out, await writeXlsx([{ name: '标题卖点', header: [...table.header, ...extraHead], rows, red, wrap: [base + o.titleCount] }], '篝火 · AI 标题卖点批量生成'));
    ctx.progress(1);

    const titles = results.reduce((a, x) => a + ('error' in x.res ? 0 : x.res.titles.length), 0);
    const over = results.reduce((a, x) => a + ('error' in x.res ? 0 : x.res.titles.filter((t) => t.over).length), 0);
    const head = [
      `${results.length} 个商品，生成 ${titles} 个标题`,
      o.limit > 0 ? (over ? `${over} 个超过 ${o.limit} 字（Excel 里已标红）` : `都在 ${o.limit} 字以内`) : '未设字数上限，没有检查长度',
      failed.length ? `${failed.length} 个失败（原因写在「提示」列）` : '',
    ].filter(Boolean).join('，');
    const body = results.map((x) => previewText(x.prod.name, x.res, o.limit)).join('\n\n');
    return { summary: head, outputPath: out, text: `${head}。\n已保存：${out}\n\n${body}` };
  },
};

export default tool;
