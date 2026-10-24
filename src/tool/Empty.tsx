// 空状态：画出「商品表一行 → 大模型 → 三个标题（带字数条）+ 卖点」，示例用真实感的中文
import { Upload } from 'lucide-react';
import './tool.css';

const TITLES: [string, number, boolean][] = [
  ['316不锈钢保温杯500毫升大容量便携防漏', 23, false],
  ['保温杯男女上班族办公室长效保温12小时', 22.5, false],
  ['一键开盖保温杯316内胆防漏便携通勤户外学生党', 30.5, true],
];

export function Empty({ hover }: { hover: boolean }) {
  return (
    <div className="tw-empty">
      <svg viewBox="0 0 560 230" role="img" aria-label="商品表格的一行商品信息，交给大模型，写出三个带字数检查的标题和几条卖点">
        <g>
          <rect x="6" y="20" width="140" height="150" rx="6" className="tw-card" />
          <rect x="6" y="20" width="140" height="22" rx="6" className="tw-top" />
          <text x="16" y="35" className="tw-tt">商品清单.xlsx</text>
          {[['商品名称', '保温杯'], ['品类', '水杯'], ['卖点关键词', '316 防漏'], ['适用人群', '上班族']].map(([k, v], i) => (
            <g key={k}>
              <text x="16" y={64 + i * 26} className="tw-k">{k}</text>
              <text x="16" y={78 + i * 26} className="tw-v">{v}</text>
            </g>
          ))}
        </g>
        <path d="M152 95 H184 M176 87 L186 95 L176 103" className="tw-arrow" />
        <g>
          <rect x="192" y="52" width="72" height="86" rx="8" className="tw-step" />
          <text x="228" y="86" textAnchor="middle" className="tw-st1">大模型</text>
          <text x="228" y="104" textAnchor="middle" className="tw-st2">写标题</text>
          <text x="228" y="120" textAnchor="middle" className="tw-st2">去极限词</text>
        </g>
        <path d="M270 95 H298 M290 87 L300 95 L290 103" className="tw-arrow" />
        <g>
          <rect x="306" y="6" width="248" height="188" rx="6" className="tw-card hot" />
          <rect x="306" y="6" width="248" height="22" rx="6" className="tw-top hot" />
          <text x="316" y="21" className="tw-tt">商品清单-标题卖点.xlsx</text>
          {TITLES.map(([t, n, over], i) => (
            <g key={t}>
              <text x="316" y={50 + i * 36} className="tw-ti">{t.length > 17 ? t.slice(0, 17) + '…' : t}</text>
              <rect x="316" y={57 + i * 36} width="190" height="6" rx="3" className="tw-track" />
              <rect x="316" y={57 + i * 36} width={Math.min(190, (n / 30) * 150)} height="6" rx="3" className={over ? 'tw-fill over' : 'tw-fill'} />
              <line x1="466" x2="466" y1={54 + i * 36} y2={66 + i * 36} className="tw-limit" />
              <text x="546" y={64 + i * 36} textAnchor="end" className={over ? 'tw-n over' : 'tw-n'}>{n} 字</text>
            </g>
          ))}
          <rect x="316" y="152" width="92" height="18" rx="9" className="tw-chip" />
          <text x="362" y="165" textAnchor="middle" className="tw-pt">316内胆更放心</text>
          <rect x="414" y="152" width="76" height="18" rx="9" className="tw-chip" />
          <text x="452" y="165" textAnchor="middle" className="tw-pt">保温12小时</text>
          <rect x="496" y="152" width="52" height="18" rx="9" className="tw-chip" />
          <text x="522" y="165" textAnchor="middle" className="tw-pt">卖点 4 条</text>
          <text x="316" y="186" className="tw-cap2">竖线是字数上限，超出的标题标红</text>
        </g>
        <text x="76" y="204" textAnchor="middle" className="tw-cap">一行一个商品</text>
        <text x="228" y="204" textAnchor="middle" className="tw-cap">逐个生成</text>
        <text x="430" y="218" textAnchor="middle" className="tw-cap">原表加上标题、卖点、提示列</text>
      </svg>
      <h2 className="tw-title">{hover ? '松开鼠标，开始添加' : '把商品表格拖进来'}</h2>
      <p className="tw-act"><Upload size={15} />支持 Excel、CSV 表格，至少要有一列商品名；点左上「添加」也行</p>
    </div>
  );
}
