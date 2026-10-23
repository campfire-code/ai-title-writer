import { describe, expect, it } from 'vitest';
import { buildMessages, effectiveLimit, findBanned, finish, outputCells, parseReply, platformOf, rowToProduct, stripBanned, titleLength, type GenOptions } from './core';

const opts = (over: Partial<GenOptions> = {}): GenOptions => ({ platform: platformOf('taobao'), limit: 30, titleCount: 3, pointCount: 4, extra: '', ...over });

describe('字数', () => {
  it('淘宝：英文数字算半个字', () => {
    expect(titleLength('保温杯', 'half')).toBe(3);
    expect(titleLength('保温杯500ml', 'half')).toBe(5.5);
  });
  it('小红书：每个字符算 1 个', () => expect(titleLength('杯子ab', 'full')).toBe(4));
  it('用户填了上限就用用户的，否则按平台', () => {
    expect(effectiveLimit(platformOf('taobao'), 0)).toBe(30);
    expect(effectiveLimit(platformOf('xhs'), 0)).toBe(20);
    expect(effectiveLimit(platformOf('pdd'), 0)).toBe(0);
    expect(effectiveLimit(platformOf('pdd'), 40)).toBe(40);
    expect(platformOf('不存在').id).toBe('general');
  });
});

describe('极限词', () => {
  it('找出并去掉，长词优先', () => {
    expect(findBanned('全网第一的最好保温杯')).toEqual(['全网第一', '最好']);
    expect(stripBanned('最好用的保温杯 国家级品质').text).toBe('用的保温杯 品质');
    expect(stripBanned('100%纯棉T恤').text).toBe('纯棉T恤');
  });
  it('没有极限词时原样返回', () => expect(stripBanned('304不锈钢保温杯')).toEqual({ text: '304不锈钢保温杯', removed: [] }));
});

describe('提示词', () => {
  it('包含平台、字数规则、条数、商品信息和 JSON 格式', () => {
    const p = rowToProduct(2, ['商品名称', '品类', '规格'], ['保温杯', '水杯', '500ml'], 0, []);
    const m = buildMessages(p, opts({ extra: '突出送礼' }));
    expect(m[0].role).toBe('system');
    expect(m[0].content).toContain('极限用语');
    expect(m[1].content).toContain('淘宝 / 天猫');
    expect(m[1].content).toContain('不超过 30 个字（英文和数字算半个字）');
    expect(m[1].content).toContain('写 3 个');
    expect(m[1].content).toContain('品类：水杯');
    expect(m[1].content).toContain('突出送礼');
    expect(m[1].content).toContain('"titles"');
  });
  it('没有上限时不写字数限制', () => {
    const p = rowToProduct(2, ['名称'], ['杯'], 0, []);
    expect(buildMessages(p, opts({ platform: platformOf('pdd'), limit: 0 }))[1].content).toContain('长度适中');
  });
  it('指定参考列时只带这些列', () => {
    const p = rowToProduct(2, ['名称', '品类', '成本'], ['杯', '水杯', '9'], 0, [1]);
    expect(p.info).toEqual([['品类', '水杯']]);
  });
});

describe('解析回复（容错）', () => {
  it('标准 JSON', () => expect(parseReply('{"titles":["a","b"],"points":["x"]}')).toEqual({ titles: ['a', 'b'], points: ['x'] }));
  it('```json 包裹加解释文字', () => expect(parseReply('好的：\n```json\n{"titles":["a"],"points":["x","y"]}\n```')).toEqual({ titles: ['a'], points: ['x', 'y'] }));
  it('中文键名、带编号', () => expect(parseReply('{"标题":["1. a","2. b"],"卖点":"- x\\n- y"}')).toEqual({ titles: ['a', 'b'], points: ['x', 'y'] }));
  it('卖点缺失时为空', () => expect(parseReply('{"titles":["a"]}').points).toEqual([]));
  it('没有标题时报错', () => expect(() => parseReply('{"points":["x"]}')).toThrow('没有返回标题'));
  it('不是 JSON 时按行当标题', () => expect(parseReply('1. 标题甲\n2. 标题乙').titles).toEqual(['标题甲', '标题乙']));
  it('空回复报错', () => expect(() => parseReply('')).toThrow());
});

describe('收尾', () => {
  it('去极限词、去重、截条数、标记超长、写提示', () => {
    const f = finish({ titles: ['最好的保温杯', '保温杯', '保温杯', '超长'.repeat(20), '多余'], points: ['第一保温', '轻'] }, opts());
    expect(f.titles.map((t) => t.text)).toEqual(['的保温杯', '保温杯', '超长'.repeat(20)]);
    expect(f.titles[2].over).toBe(true);
    expect(f.points).toEqual(['保温', '轻']);
    expect(f.notes.join('；')).toContain('1 个标题超过 30 字');
    expect(f.notes.join('；')).toContain('卖点只有 2 条');
    expect(f.notes.join('；')).toContain('已去掉极限词：最好、第一');
  });
  it('输出列：成功与失败', () => {
    const f = finish({ titles: ['甲', '乙'], points: ['x', 'y', 'z'] }, opts({ titleCount: 2 }));
    expect(outputCells(f, 2)).toEqual(['甲', '乙', '1. x\n2. y\n3. z', '']);
    expect(outputCells({ error: '超时' }, 2)).toEqual(['', '', '', '生成失败：超时']);
  });
});
