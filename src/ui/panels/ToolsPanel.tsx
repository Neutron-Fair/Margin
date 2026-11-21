import type { PanelName } from '../../App.tsx';

interface Props {
  onOpen: (p: PanelName) => void;
  onClose: () => void;
  onReset: () => void;
}

interface Item {
  key: PanelName;
  label: string;
  desc: string;
}

const GROUPS: Array<{ title: string; items: Item[] }> = [
  {
    title: '录入',
    items: [
      { key: 'ocr', label: '识图录入', desc: '拍照或截图，自动读出工艺术语' },
      { key: 'ai', label: 'AI 助手', desc: '口述或粘贴订单，自动填参数' },
    ],
  },
  {
    title: '存档',
    items: [
      { key: 'schemes', label: '方案库', desc: '整套参数 + 单据，随时切回' },
      { key: 'presets', label: '预设库', desc: '常用纸张与工艺档位，一键套用' },
    ],
  },
  {
    title: '工具',
    items: [
      { key: 'tiers', label: '成本分档', desc: '按数量测算不同档位的单本价' },
      { key: 'check', label: '参数自检', desc: '查一遍不合常理的数值' },
      { key: 'settings', label: '设置', desc: 'AI 与识图接口、导出与备份' },
      { key: 'update', label: '检查更新', desc: '从 GitHub 拉取新版本' },
    ],
  },
];

/**
 * 「更多」：把一次性动作（录入 / 存档 / 工具 / 重置）集中成一页。
 * 目的地（算价、明细、报价单）已经由底部导航承担，这里不再重复。
 */
export function ToolsPanel({ onOpen, onClose, onReset }: Props) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="更多">
        <div className="sheet-head">
          <span className="sheet-title">
            <span className="bracket">MORE</span>
            更多
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>
        <div className="sheet-body">
          {GROUPS.map((g) => (
            <div className="menu-group" key={g.title}>
              <div className="menu-group-title">{g.title}</div>
              {g.items.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  className="list-row menu-row"
                  onClick={() => onOpen(it.key)}
                >
                  <span className="list-main">
                    <span className="list-name">{it.label}</span>
                    <span className="list-meta">{it.desc}</span>
                  </span>
                  <span className="menu-chevron" aria-hidden="true">
                    ›
                  </span>
                </button>
              ))}
            </div>
          ))}

          <div className="menu-group">
            <div className="menu-group-title">危险</div>
            <button
              type="button"
              className="list-row menu-row is-danger"
              onClick={() => {
                if (window.confirm('恢复默认参数会清空当前草稿，方案库不受影响。继续？')) {
                  onReset();
                  onClose();
                }
              }}
            >
              <span className="list-main">
                <span className="list-name">恢复默认参数</span>
                <span className="list-meta">清空当前草稿，方案库不受影响</span>
              </span>
              <span className="menu-chevron" aria-hidden="true">
                ›
              </span>
            </button>
          </div>

          <p className="menu-foot">
            计算口径：备损只计入印刷费，运费单列不计入成本。
            <br />
            数据仅存本机，不上传。
          </p>
        </div>
      </div>
    </div>
  );
}
