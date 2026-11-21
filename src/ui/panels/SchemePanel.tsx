import { useState } from 'react';
import type { Scheme } from '../../store/storage.ts';
import { exportAll, importAll } from '../../store/storage.ts';
import { downloadJson, pickJsonFile } from '../../export/files.ts';
import { fmtUnit } from '../utils.ts';
import { calcOrder } from '../../engine/calc.ts';

interface Props {
  schemes: Scheme[];
  onApply: (s: Scheme) => void;
  onSave: (name: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

export function SchemePanel({ schemes, onApply, onSave, onDelete, onClose }: Props) {
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');

  const doSave = () => {
    const n = name.trim();
    if (!n) {
      setMsg('先给方案起个名字');
      return;
    }
    onSave(n);
    setName('');
  };

  const doExportAll = () => {
    downloadJson(exportAll(), `线圈本-备份-${new Date().toISOString().slice(0, 10)}.json`);
    setMsg('已导出备份文件');
  };

  const doImport = async () => {
    const data = await pickJsonFile();
    if (!data) {
      setMsg('未选择文件或文件格式不正确');
      return;
    }
    if (!window.confirm('导入将覆盖备份中包含的现有草稿、方案和设置。密钥不会导入。确定继续吗？')) return;
    const res = importAll(data);
    if (res.ok) {
      setMsg('导入完成，正在重新载入…');
      setTimeout(() => window.location.reload(), 600);
    } else {
      setMsg(res.message);
    }
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="方案库">
        <div className="sheet-head">
          <span className="sheet-title">
            <span className="bracket">LIBRARY</span>
            方案库
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="sheet-body">
          <div className="setting-row">
            <span className="label">保存当前</span>
            <div className="field">
              <div className="field-box">
                <input
                  type="text"
                  placeholder="如：客户A · 1000本 · 覆膜烫金"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') doSave();
                  }}
                />
              </div>
            </div>
            <button type="button" className="btn btn-solid" onClick={doSave}>
              保存
            </button>
          </div>

          {msg && (
            <div className="note note-info" style={{ paddingBottom: 8 }}>
              <span className="note-mark" />
              <span>{msg}</span>
            </div>
          )}

          <div style={{ marginTop: 8 }}>
            {schemes.length === 0 ? (
              <div className="empty">还没有保存的方案。调好参数后在上面起个名字保存。</div>
            ) : (
              schemes.map((s) => {
                const r = calcOrder(s.params);
                return (
                  <div className="list-row" key={s.id}>
                    <div className="list-main">
                      <div className="list-name">
                        {s.name}
                        <span className="label" style={{ color: 'var(--ink-3)' }}>
                          ¥{fmtUnit(r.unitFinalPrice)}/本
                        </span>
                      </div>
                      <div className="list-meta">
                        {s.params.orderQty} 本 · 总成本 ¥{r.costTotal.toFixed(2)} ·{' '}
                        {new Date(s.updatedAt).toLocaleString('zh-CN', {
                          month: '2-digit',
                          day: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {s.doc.client ? ` · ${s.doc.client}` : ''}
                      </div>
                    </div>
                    <button type="button" className="btn" onClick={() => onApply(s)}>
                      载入
                    </button>
                    <button type="button" className="btn btn-ghost" onClick={() => onDelete(s.id)}>
                      删除
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="sheet-foot">
          <button type="button" className="btn btn-ghost" onClick={doImport}>
            导入备份
          </button>
          <button type="button" className="btn" onClick={doExportAll}>
            导出全部数据
          </button>
        </div>
      </div>
    </div>
  );
}
