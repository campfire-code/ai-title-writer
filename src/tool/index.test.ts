import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import tool from './index';
import { readSheets, writeXlsx } from './xlsx';
import type { InputItem, Params, RunContext } from '../kit/types';

type Llm = RunContext['llm'];
// 内存文件系统 + 假大模型
function fakeCtx(files: Map<string, Uint8Array>, params: Params, llm: Llm): RunContext {
  return {
    params, outputDir: '/out', signal: new AbortController().signal, progress: () => {},
    readFile: async (p) => files.get(p)!,
    readText: async (p) => new TextDecoder().decode(files.get(p)!),
    writeFile: async (p, d) => void files.set(p, d),
    writeText: async (p, t) => void files.set(p, new TextEncoder().encode(t)),
    mkdir: async () => {},
    join: async (...parts) => parts.join('/'),
    llm, sidecar: async () => '',
  };
}
const defaults = (over: Params): Params => ({ ...Object.fromEntries(tool.params.map((f) => [f.key, f.default])), ...over });
const item = (name: string): InputItem => ({ id: name, name, path: '/in/' + name });
const products = async () => writeXlsx([{ name: 'S', header: ['商品名称', '品类', '卖点关键词'], rows: [['不锈钢保温杯', '水杯', '保温12小时'], ['帆布托特包', '箱包', '大容量'], [null, null, null]] }]);

describe('完整流程', () => {
  it('每个商品生成标题和卖点，导出原列 + 生成列，超长标红、去掉极限词', async () => {
    const files = new Map([['/in/商品.xlsx', await products()]]);
    const prompts: string[] = [];
    const llm: Llm = async (m) => {
      prompts.push(m[1].content);
      return m[1].content.includes('保温杯')
        ? '```json\n{"titles":["最好用的不锈钢保温杯","保温杯男女学生便携大容量水杯子办公室家用户外运动款加厚防摔礼盒装送朋友"],"points":["保温12小时","304不锈钢","一键开盖"]}\n```'
        : '{"标题":["帆布托特包大容量","通勤帆布包"],"卖点":["装得下电脑","耐磨"]}';
    };
    const ctx = fakeCtx(files, defaults({ titleCount: 2, pointCount: 3 }), llm);
    const r = await tool.run(item('商品.xlsx'), ctx);
    expect(prompts).toHaveLength(2);
    expect(r.summary).toBe('2 个商品，生成 4 个标题，1 个超过 30 字（Excel 里已标红）');
    expect(r.outputPath).toBe('/out/商品-标题卖点.xlsx');
    expect(r.text).toContain('【不锈钢保温杯】');

    const [s] = await readSheets(files.get('/out/商品-标题卖点.xlsx')!, 'x.xlsx');
    expect(s.grid[0]).toEqual(['商品名称', '品类', '卖点关键词', '标题1', '标题2', '卖点', '提示']);
    expect(s.grid[1].slice(3, 5)).toEqual(['用的不锈钢保温杯', '保温杯男女学生便携大容量水杯子办公室家用户外运动款加厚防摔礼盒装送朋友']);
    expect(s.grid[1][5]).toBe('1. 保温12小时\n2. 304不锈钢\n3. 一键开盖');
    expect(s.grid[1][6]).toContain('已去掉极限词：最好');
    expect(s.grid[2][5]).toBe('1. 装得下电脑\n2. 耐磨');
    expect(s.grid[2][6]).toBe('卖点只有 2 条');
    expect(s.grid).toHaveLength(3);

    const wb = new ExcelJS.Workbook();
    const buf = files.get('/out/商品-标题卖点.xlsx')!;
    await wb.xlsx.load(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    expect(wb.worksheets[0].getCell('E2').font?.color?.argb).toBe('FFC00000');
    expect(wb.worksheets[0].getCell('D2').font?.color?.argb).toBeUndefined();
  });

  it('单个商品解析失败会重试一次，仍失败则写进提示列，其他商品照常', async () => {
    const files = new Map([['/in/a.csv', new TextEncoder().encode('品名,规格\n杯子,500ml\n包,大号\n')]]);
    let cupCalls = 0;
    const llm: Llm = async (m) => {
      if (m[1].content.includes('商品名：杯子')) { cupCalls++; return '{"points":["x"]}'; }
      return '{"titles":["包"],"points":["a","b","c"]}';
    };
    const r = await tool.run(item('a.csv'), fakeCtx(files, defaults({ titleCount: 1 }), llm));
    expect(cupCalls).toBe(2);
    expect(r.summary).toContain('1 个失败');
    const [s] = await readSheets(files.get('/out/a-标题卖点.xlsx')!, 'x.xlsx');
    expect(s.grid[1][4]).toBe('生成失败：大模型没有返回标题');
    expect(s.grid[2][2]).toBe('包');
  });

  it('没配置大模型时整个文件失败，提示去设置页', async () => {
    const files = new Map([['/in/a.csv', new TextEncoder().encode('商品名称\n杯子\n')]]);
    const llm: Llm = async () => { throw new Error('还没有设置大模型：请到「设置」里填写接口地址、密钥和模型名'); };
    await expect(tool.run(item('a.csv'), fakeCtx(files, defaults({}), llm))).rejects.toThrow('还没有设置大模型');
  });

  it('认不出商品名列时提示表头', async () => {
    const files = new Map([['/in/a.csv', new TextEncoder().encode('编号,颜色\n1,红\n')]]);
    await expect(tool.run(item('a.csv'), fakeCtx(files, defaults({}), async () => ''))).rejects.toThrow('表头是：编号、颜色');
  });

  it('指定的参考列不存在时提示', async () => {
    const files = new Map([['/in/a.csv', new TextEncoder().encode('商品名称,品类\n杯子,水杯\n')]]);
    await expect(tool.run(item('a.csv'), fakeCtx(files, defaults({ infoCols: '品类，价格' }), async () => ''))).rejects.toThrow('「价格」找不到');
  });

  it('小红书按 20 字检查', async () => {
    const files = new Map([['/in/a.csv', new TextEncoder().encode('商品名称\n杯子\n')]]);
    const llm: Llm = async () => '{"titles":["一二三四五六七八九十一二三四五六七八九十一"],"points":["a","b","c"]}';
    const r = await tool.run(item('a.csv'), fakeCtx(files, defaults({ platform: 'xhs', titleCount: 1 }), llm));
    expect(r.summary).toContain('1 个超过 20 字');
  });
});
