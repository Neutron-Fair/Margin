import { useMemo, useState } from 'react';
import type { OrderParams } from '../../engine/types.ts';
import type { UserPreset } from '../../store/storage.ts';
import { BUILTIN_PRESETS, PRESET_TARGETS } from '../presetsData.ts';

interface Props {
  params: OrderParams;
  onChange: (path: string, value: unknown) => void;
  onClose: () => void;
  onToast: (msg: string) => void;
}

/** 依据预设写入的字段，判断它只能应用到哪些模块，避免把纸张字段写进「线圈」 */
function allowedTargets(p: UserPreset): string[] {
  const paths = p.values.map((v) => v.path);
  if (paths.some((x) => x === 'gram' || x === 'ton')) {
    return ['inner', 'liner', 'cover', 'back', 'gray'];
  }
  if (paths.some((x) => x === 'foilPrice' || x === 'uvPrice')) {
    return ['cover', 'back'];
  }
  if (paths.some((x) => x === 'coilPrice' || x === 'bindingFee' || x === 'packagingFee')) {
    return ['misc'];
  }
  return ['inner', 'liner', 'cover', 'back', 'gray', 'misc'];
}

const TARGET_LABEL: Record<string, string> = {
  inner: '内页',
  liner: '衬纸',
  cover: '封面',
  back: '封底',
  gray: '灰板',
  misc: '线圈装订',
};

export function PresetPanel({ params, onChange, onClose, onToast }: Props) {
  const [target, setTarget] = useState('inner');

  const groups = useMemo(() => {
    const map = new Map<string, UserPreset[]>();
    for (const p of BUILTIN_PRESETS) {
      const arr = map.get(p.group) ?? [];
      arr.push(p);
      map.set(p.group, arr);
    }
    return Array.from(map.entries());
  }, []);

  const apply = (preset: UserPreset) => {
    if (!allowedTargets(preset).includes(target)) return;
    for (const v of preset.values) {
      onChange(`${target}.${v.path}`, v.value);
    }
    onToast(`已把「${preset.name}」应用到${TARGET_LABEL[target] ?? target}`);
  };

  const currentText = (() => {
    if (target === 'misc') {
      return `线圈 ${params.misc.coilPrice} 元/个 · 装订 ${params.misc.bindingFee} 元/本 · 包装 ${params.misc.packagingFee} 元/本`;
    }
    if (target === 'gray') return `${params.gray.gram}g · ${params.gray.ton} 元/吨`;
    const m = params[target as 'inner' | 'liner' | 'cover' | 'back'];
    return m ? `${m.gram}g · ${m.ton} 元/吨` : '';
  })();

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="预设库">
        <div className="sheet-head">
          <span className="sheet-title">
            <span className="bracket">PRESETS</span>
            常用参数档位
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="sheet-body">
          <div className="setting-row" style={{ borderBottom: '1px solid var(--hair)' }}>
            <span className="label">应用到</span>
            <div className="field">
              <div className="field-box">
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  {PRESET_TARGETS.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {groups.map(([group, list]) => (
            <div key={group} style={{ marginTop: 14 }}>
              <div className="label" style={{ marginBottom: 6 }}>
                {group}
              </div>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                  gap: 8,
                }}
              >
                {list.map((p) => {
                  const allowed = allowedTargets(p);
                  const usable = allowed.includes(target);
                  return (
                    <button
                      type="button"
                      key={p.id}
                      className="btn"
                      disabled={!usable}
                      onClick={() => apply(p)}
                      title={
                        usable
                          ? undefined
                          : `该档位只适用于：${allowed.map((a) => TARGET_LABEL[a] ?? a).join(' / ')}`
                      }
                      style={{
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                        gap: 2,
                        padding: '9px 12px',
                        minHeight: 52,
                        opacity: usable ? 1 : 0.38,
                      }}
                    >
                      <span style={{ fontSize: 12.5, fontFamily: 'var(--serif)' }}>{p.name}</span>
                      {p.desc && (
                        <span style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{p.desc}</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="note" style={{ marginTop: 16 }}>
            <span className="note-mark" />
            <span>
              当前{TARGET_LABEL[target] ?? target}：{currentText}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
