// 结果展示：顶部大字（商品数、标题数、超长数），下面每个商品一张卡，标题带字数条，超长的标红，卖点列成小标签
import { AlertTriangle, Info } from 'lucide-react';
import type { InputItem, ItemResult } from '../kit/types';
import './tool.css';

interface Title { text: string; len: number; over: boolean }
interface Block { name: string; error?: string; titles: Title[]; points: string[]; notes: string }

/** 把 previewText 生成的文字还原成结构（格式见 core.ts 的 previewText） */
function parse(text: string): { head: string; blocks: Block[] } {
  const parts = text.split(/\n\n(?=【)/);
  const head = (parts[0].split('\n')[0] ?? '').replace(/。$/, '');
  const first = parts[0].slice(parts[0].indexOf('\n\n') + 2);
  const blocks: Block[] = [];
  for (const raw of [first, ...parts.slice(1)]) {
    const lines = raw.split('\n');
    const m = /^【(.*?)】(生成失败：(.*))?$/.exec(lines[0] ?? '');
    if (!m) continue;
    const b: Block = { name: m[1], error: m[3], titles: [], points: [], notes: '' };
    for (const l of lines.slice(1)) {
      const t = /^\d+\. (.*)（([\d.]+) 字(，超过 \d+ 字)?）$/.exec(l);
      if (t) b.titles.push({ text: t[1], len: Number(t[2]), over: !!t[3] });
      else if (l.startsWith('卖点：')) b.points = l.slice(3).split(' / ').filter(Boolean);
      else if (l.startsWith('提示：')) b.notes = l.slice(3);
    }
    blocks.push(b);
  }
  return { head, blocks };
}

export function ResultBody({ result }: { item: InputItem; result: ItemResult }) {
  if (!result.text) return <p className="tw-sub">{result.summary}</p>;
  const { head, blocks } = parse(result.text);
  const limit = Number(/超过 (\d+) 字|都在 (\d+) 字以内/.exec(head)?.slice(1).find(Boolean) ?? 0);
  const titleN = blocks.reduce((a, b) => a + b.titles.length, 0);
  const overN = blocks.reduce((a, b) => a + b.titles.filter((t) => t.over).length, 0);
  const failN = blocks.filter((b) => b.error).length;
  const scale = limit > 0 ? limit * 1.25 : Math.max(30, ...blocks.flatMap((b) => b.titles.map((t) => t.len)));
  return (
    <div className="tw-body">
      <div className="tw-stats">
        <div><b className="k-num">{blocks.length}</b><span>个商品</span></div>
        <div><b className="k-num">{titleN}</b><span>个标题</span></div>
        <div className={overN ? 'bad' : 'good'}><b className="k-num">{overN}</b><span>{limit > 0 ? `个超过 ${limit} 字` : '未检查字数'}</span></div>
        {failN > 0 && <div className="bad"><b className="k-num">{failN}</b><span>个失败</span></div>}
      </div>
      <div className="tw-list">
        {blocks.map((b, bi) => (
          <article key={bi} className="tw-prod">
            <h4>{b.name}</h4>
            {b.error ? <p className="tw-fail"><AlertTriangle size={14} />生成失败：{b.error}</p> : (
              <>
                <ol className="tw-titles">
                  {b.titles.map((t, i) => (
                    <li key={i} className={t.over ? 'over' : ''}>
                      <span className="tw-t">{t.text}</span>
                      <span className="tw-len k-num">{t.len} 字{t.over && <em>超长</em>}</span>
                      <span className="tw-meter" aria-hidden="true">
                        <i style={{ width: `${Math.min(100, (t.len / scale) * 100)}%` }} />
                        {limit > 0 && <u style={{ left: `${(limit / scale) * 100}%` }} />}
                      </span>
                    </li>
                  ))}
                </ol>
                {b.points.length > 0 && <ul className="tw-points">{b.points.map((p, i) => <li key={i}>{p}</li>)}</ul>}
                {b.notes && <p className="tw-note"><Info size={13} />{b.notes}</p>}
              </>
            )}
          </article>
        ))}
      </div>
    </div>
  );
}
