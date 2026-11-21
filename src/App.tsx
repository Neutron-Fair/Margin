import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { calcOrder } from './engine/calc.ts';
import { validateParams, validateSafety } from './engine/validate.ts';
import { Field } from './ui/Field.tsx';
import type { OrderParams } from './engine/types.ts';
import { MODULES } from './ui/schema.ts';
import { fmtMoney, fmtUnit, setPath as setAt, todayISO } from './ui/utils.ts';
import { ModuleSection } from './ui/ModuleSection.tsx';
import { ResultPanel } from './ui/ResultPanel.tsx';
import { MobileDock, type MobileTab } from './ui/MobileDock.tsx';
import {
  loadDraft,
  saveDraft,
  loadSchemes,
  saveSchemes,
  resetDraft,
  type DocMeta,
  type Scheme,
} from './store/storage.ts';
import { QuoteSheet } from './ui/panels/QuoteSheet.tsx';
import { SchemePanel } from './ui/panels/SchemePanel.tsx';
import { PresetPanel } from './ui/panels/PresetPanel.tsx';
import { ResultDetailPanel } from './ui/panels/ResultDetailPanel.tsx';
import { AiPanel } from './ui/panels/AiPanel.tsx';
import { OcrPanel } from './ui/panels/OcrPanel.tsx';
import { SettingsPanel } from './ui/panels/SettingsPanel.tsx';
import { TiersPanel } from './ui/panels/TiersPanel.tsx';
import { CheckPanel } from './ui/panels/CheckPanel.tsx';
import { ToolsPanel } from './ui/panels/ToolsPanel.tsx';
import { UpdatePanel } from './ui/panels/UpdatePanel.tsx';
import { QtyInput } from './ui/QtyInput.tsx';

export type PanelName =
  | 'quote'
  | 'schemes'
  | 'presets'
  | 'result'
  | 'tiers'
  | 'check'
  | 'ai'
  | 'ocr'
  | 'settings'
  | 'tools'
  | 'update'
  | null;

export default function App() {
  const initial = useMemo(() => loadDraft(), []);
  const [params, setParams] = useState<OrderParams>(initial.params);
  const [doc, setDoc] = useState<DocMeta>(initial.doc);
  const [openIds, setOpenIds] = useState<string[]>([]);
  const [panel, setPanel] = useState<PanelName>(null);
  const [schemes, setSchemes] = useState<Scheme[]>(() => loadSchemes());
  const [toast, setToast] = useState<string | null>(null);
  /** 手机端：单据信息默认折叠成一行摘要，点开才显示 4 个输入框 */
  const [docExpanded, setDocExpanded] = useState(false);

  /**
   * 浮层开合：关闭时先让退场动画播完再卸载，
   * 否则 React 直接卸载节点等于 display:none 瞬切，退场过渡会被吞掉。
   */
  const [panelClosing, setPanelClosing] = useState(false);
  const closeTimer = useRef<number | null>(null);

  const openPanel = useCallback((name: PanelName) => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    setPanelClosing(false);
    setPanel(name);
  }, []);

  const closePanel = useCallback(() => {
    if (closeTimer.current !== null) return;
    setPanelClosing(true);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setPanel(null);
      setPanelClosing(false);
    }, reduced ? 0 : 220);
  }, []);

  useEffect(() => {
    document.body.dataset.panelState = panel ? (panelClosing ? 'closing' : 'open') : 'closed';
  }, [panel, panelClosing]);

  useEffect(
    () => () => {
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    },
    [],
  );

  const invalidDrafts = useRef(new Set<string>());
  const [draftVersion, setDraftVersion] = useState(0);
  const [rollbackNotice, setRollbackNotice] = useState(false);
  const safetyIssues = useMemo(() => validateSafety(params), [params]);
  const blocked = safetyIssues.length > 0 || invalidDrafts.current.size > 0 || rollbackNotice;
  const result = useMemo(() => blocked ? null : calcOrder(params), [params, blocked, draftVersion]);
  const issues = useMemo(() => validateParams(params), [params]);

  const onValidityChange = useCallback((path: string, valid: boolean) => {
    const wasInvalid = invalidDrafts.current.has(path);
    if (valid) invalidDrafts.current.delete(path); else invalidDrafts.current.add(path);
    if (wasInvalid && valid) {
      setRollbackNotice(true);
    }
    setDraftVersion(v => v + 1);
  }, []);
  const guard = () => {
    if (validateSafety(params).length || invalidDrafts.current.size || rollbackNotice) {
      setToast('存在无效输入或已回退的输入，请核对后再操作');
      return false;
    }
    return true;
  };
  const openProtectedPanel = (name: PanelName) => { if (guard()) openPanel(name); };

  useEffect(() => {
    if (blocked) return;
    const t = setTimeout(() => {
      try { saveDraft(params, doc); } catch { setToast('草稿自动保存失败，请检查存储空间或权限'); }
    }, 300);
    return () => clearTimeout(t);
  }, [params, doc, blocked]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(t);
  }, [toast]);

  const onChange = useCallback((path: string, value: unknown) => {
    setParams((p) => setAt(p, path, value));
  }, []);

  const onDocChange = useCallback((key: keyof DocMeta, value: string) => {
    setDoc((d) => ({ ...d, [key]: value }));
  }, []);

  const toggleModule = useCallback((id: string) => {
    setOpenIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
  }, []);

  const summaryOf = (id: string): string => {
    const r = result;
    if (!r) return '输入无效，暂停计算';
    switch (id) {
      case 'inner':
        return `¥${fmtUnit(r.modules.inner.perBook)} /本`;
      case 'liner':
        return `¥${fmtUnit(r.modules.liner.perBook)} /本`;
      case 'cover':
        return `¥${fmtUnit(r.modules.cover.perBook)} /本`;
      case 'back':
        return `¥${fmtUnit(r.modules.back.perBook)} /本`;
      case 'gray':
        return `¥${fmtUnit(r.modules.gray.perBook)} /本`;
      case 'misc': {
        const per =
          params.misc.coilPrice * params.misc.coilsPerBook +
          params.misc.bindingFee +
          params.misc.packagingFee;
        return `¥${fmtUnit(per)} /本`;
      }
      case 'waste':
        return `固定 ¥${fmtMoney(params.misc.fixedOverhead)}`;
      case 'profit':
        return `${params.profitTax.profitRate}% + ${params.profitTax.taxRate}%`;
      default:
        return '';
    }
  };

  const footOf = (id: string): string[] => {
    const r = result;
    if (!r) return [];
    switch (id) {
      case 'inner':
        return [
          `拼版 ${r.modules.inner.detail.finalSheets} 印张`,
          `印次 ${r.modules.inner.detail.impressions}`,
          `印刷费 ¥${fmtMoney(r.modules.inner.detail.printCost)}`,
        ];
      case 'liner':
        return [
          `拼版 ${r.modules.liner.detail.finalSheets} 印张`,
          `印次 ${r.modules.liner.detail.impressions}`,
          `印刷费 ¥${fmtMoney(r.modules.liner.detail.printCost)}`,
        ];
      case 'cover': {
        const d = r.modules.cover.detail;
        const out = [`拼版 ${d.finalSheets} 印张`, `印刷费 ¥${fmtMoney(d.printCost)}`];
        if (d.laminate > 0) out.push(`覆膜 ¥${fmtMoney(d.laminate)}`);
        if (d.foil > 0) out.push(`烫金 ¥${fmtMoney(d.foil)}`);
        if (d.uv > 0) out.push(`UV ¥${fmtMoney(d.uv)}`);
        if (d.baseSheets > 0) out.push(`每手 ${d.baseSheets} 本`);
        return out;
      }
      case 'back': {
        const d = r.modules.back.detail;
        const out = [`拼版 ${d.finalSheets} 印张`, `印刷费 ¥${fmtMoney(d.printCost)}`];
        if (d.laminate > 0) out.push(`覆膜 ¥${fmtMoney(d.laminate)}`);
        if (d.foil > 0) out.push(`烫金 ¥${fmtMoney(d.foil)}`);
        if (d.uv > 0) out.push(`UV ¥${fmtMoney(d.uv)}`);
        return out;
      }
      case 'gray':
        return [];
      case 'misc':
        return [
          `线圈 ¥${fmtMoney(r.misc.coilTotal)}`,
          `装订 ¥${fmtMoney(r.misc.bindingTotal)}`,
          `包装 ¥${fmtMoney(r.misc.packTotal)}`,
        ];
      case 'waste':
        return [
          `每本摊 ¥${fmtUnit(r.overheadPerBook)}`,
          `损耗 ¥${fmtMoney(r.wasteAmount)}`,
        ];
      case 'profit':
        return [`利润 ¥${fmtMoney(r.profitAmount)}`, `税额 ¥${fmtMoney(r.taxAmount)}`];
      default:
        return [];
    }
  };

  const applyScheme = (s: Scheme) => {
    invalidDrafts.current.clear();
    setRollbackNotice(false);
    setParams(s.params);
    setDoc(s.doc);
    closePanel();
    setToast(`已载入方案「${s.name}」`);
  };

  const doSave = (name: string) => {
    if (!guard()) return;
    const now = Date.now();
    const next: Scheme = {
      id: `s${now.toString(36)}`,
      name,
      createdAt: now,
      updatedAt: now,
      params,
      doc,
    };
    const list = [next, ...schemes];
    try { saveSchemes(list); } catch { setToast('方案保存失败，请检查存储空间或权限'); return; }
    setSchemes(list);
    closePanel();
    setToast(`已保存「${name}」`);
  };

  const doDeleteScheme = (id: string) => {
    const list = schemes.filter((s) => s.id !== id);
    try { saveSchemes(list); } catch { setToast('方案删除失败，请检查存储空间或权限'); return; }
    setSchemes(list);
  };

  const doReset = () => {
    try {
      const r = resetDraft();
      invalidDrafts.current.clear();
      setRollbackNotice(false);
      setParams(r.params);
      setDoc(r.doc);
      setToast('已恢复默认参数');
    } catch { setToast('重置失败，请检查存储空间或权限'); }
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="shell">
          <div className="brand">
            <div className="brand-kicker">Coil Book · Cost System</div>
            <h1 className="brand-title serif">线圈本 · 全工艺成本核算</h1>
            <div className="brand-sub">
              内页 / 衬纸 / 封面 / 封底 / 灰板 · 覆膜 / 烫金 / UV · 利润与税 · 运费单列 · 单本到货价
            </div>
          </div>

          <div className="header-actions">
            <button type="button" className="btn btn-ghost" onClick={() => openProtectedPanel('schemes')}>
              方案库
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => openPanel('presets')}>
              预设库
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => openPanel('ocr')}>
              识图录入
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => openPanel('ai')}>
              AI 助手
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => openPanel('settings')}>
              设置
            </button>
            <button type="button" className="btn" onClick={doReset}>
              重置
            </button>
          </div>

          <button
            type="button"
            className="header-menu"
            onClick={() => openPanel('tools')}
            aria-label="更多功能"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="8" cy="8" r="1.9" />
              <circle cx="16" cy="8" r="1.9" />
              <circle cx="8" cy="16" r="1.9" />
              <circle cx="16" cy="16" r="1.9" />
            </svg>
          </button>
        </div>

        <div className="shell">
          <button
            type="button"
            className="doc-summary"
            onClick={() => setDocExpanded((v) => !v)}
            aria-expanded={docExpanded}
          >
            <span className="k">单据</span>
            <span className="v">
              {doc.no || '未编号'} · {doc.client || '未填客户'} · {doc.date || todayISO()}
            </span>
            <span className="a">{docExpanded ? '收起' : '编辑'}</span>
          </button>
          <div className={`doc-meta${docExpanded ? ' is-open' : ''}`} style={{ paddingBottom: 16 }}>
            <div className="field field-title">
              <span className="field-label">
                <span>报价单号</span>
              </span>
              <div className="field-box">
                <input
                  type="text"
                  placeholder="例 QB-2026-018"
                  value={doc.no}
                  onChange={(e) => onDocChange('no', e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <span className="field-label">
                <span>客户</span>
              </span>
              <div className="field-box">
                <input
                  type="text"
                  placeholder="客户名称"
                  value={doc.client}
                  onChange={(e) => onDocChange('client', e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <span className="field-label">
                <span>日期</span>
              </span>
              <div className="field-box">
                <input
                  type="text"
                  value={doc.date}
                  onChange={(e) => onDocChange('date', e.target.value)}
                  placeholder={todayISO()}
                />
              </div>
            </div>
            <div className="field" style={{ flex: 1, minWidth: 200 }}>
              <span className="field-label">
                <span>备注</span>
              </span>
              <div className="field-box">
                <input
                  type="text"
                  placeholder="工艺说明 / 交期"
                  value={doc.note}
                  onChange={(e) => onDocChange('note', e.target.value)}
                />
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="workspace">
        <main className="params-col">
          <div className="order-bar">
            <div className="order-qty">
              <span className="label">订单数量</span>
              <div className="field-box">
                <QtyInput value={params.orderQty} onChange={(n) => onChange('orderQty', n)} onValidityChange={onValidityChange} />
                <span className="affix">本</span>
              </div>
            </div>
            <div className="order-summary">
              <div className="chip">
                <Field def={{ path: 'shippingFee', label: '订单运费', unit: '元', step: 0.01 }} value={params.shippingFee ?? 0} onChange={onChange} onValidityChange={onValidityChange} />
              </div>
              <span className="chip">
                每本可变成本 <b>¥{result ? fmtUnit(result.varPerBook) : '—'}</b>
              </span>
              <span className="chip">
                固定摊薄 <b>¥{result ? fmtUnit(result.overheadPerBook) : '—'}</b>
              </span>
              <span className="chip">
                损耗率 <b>{params.misc.wasteRate}%</b>
              </span>
            </div>
          </div>

          {MODULES.map((m) => (
            <ModuleSection
              key={m.id}
              def={m}
              params={params}
              summary={summaryOf(m.id)}
              footExtra={footOf(m.id)}
              open={openIds.includes(m.id)}
              onToggle={() => toggleModule(m.id)}
              onChange={onChange}
              onValidityChange={onValidityChange}
            />
          ))}
        </main>

        <aside className="result-col">
          {result ? <ResultPanel
            result={result}
            params={params}
            issues={issues}
            onExport={() => openProtectedPanel('quote')}
            onSave={() => openProtectedPanel('schemes')}
            onTiers={() => openProtectedPanel('tiers')}
            onCheck={() => openProtectedPanel('check')}
          /> : <div role="alert">输入无效，已暂停报价、保存及导出。请核对参数。{safetyIssues.map(i => <div key={i.code}>{i.field ?? '结果'}：{i.detail}</div>)}{rollbackNotice && <div>先前存在无效输入：失焦会恢复之前的值，输入修正则保留新值。请核对显示的数值后确认。<button type="button" onClick={() => setRollbackNotice(false)}>已核对数值</button></div>}</div>}
        </aside>
      </div>

      {result && <MobileDock
        result={result}
        active={
          panel === 'result' ? 'detail' : panel === 'quote' ? 'quote' : panel === 'tools' ? 'more' : ('calc' as MobileTab)
        }
        onGoCalc={() => {
          closePanel();
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }}
        onOpenResult={() => openProtectedPanel('result')}
        onExport={() => openProtectedPanel('quote')}
        onOpenTools={() => openPanel('tools')}
      />}

      {panel === 'quote' && result && (
        <QuoteSheet
          params={params}
          result={result}
          doc={doc}
          onClose={() => closePanel()}
          onToast={setToast}
        />
      )}

      {panel === 'schemes' && !blocked && (
        <SchemePanel
          schemes={schemes}
          onApply={applyScheme}
          onSave={doSave}
          onDelete={doDeleteScheme}
          onClose={() => closePanel()}
        />
      )}

      {panel === 'presets' && (
        <PresetPanel
          params={params}
          onChange={onChange}
          onClose={() => closePanel()}
          onToast={setToast}
        />
      )}

      {panel === 'result' && result && (
        <ResultDetailPanel result={result} params={params} issues={issues} onClose={() => closePanel()} />
      )}

      {panel === 'tiers' && result && <TiersPanel params={params} onClose={() => closePanel()} />}

      {panel === 'check' && (
        <CheckPanel params={params} onClose={() => closePanel()} onToast={setToast} />
      )}

      {panel === 'ai' && (
        <AiPanel
          params={params}
          onChange={onChange}
          onClose={() => closePanel()}
          onToast={setToast}
        />
      )}

      {panel === 'ocr' && (
        <OcrPanel
          params={params}
          onChange={onChange}
          onClose={() => closePanel()}
          onToast={setToast}
        />
      )}

      {panel === 'settings' && (
        <SettingsPanel onClose={() => closePanel()} onToast={setToast} />
      )}

      {panel === 'update' && <UpdatePanel onClose={closePanel} onToast={setToast} />}

      {panel === 'tools' && (
        <ToolsPanel
          onClose={() => closePanel()}
          onReset={doReset}
          onOpen={(p) => ['quote', 'schemes', 'result', 'tiers', 'check'].includes(p ?? '') ? openProtectedPanel(p) : openPanel(p)}
        />
      )}

      {toast && (
        <div
          style={{
            position: 'fixed',
            left: '50%',
            bottom: 96,
            transform: 'translateX(-50%)',
            background: 'var(--ink)',
            color: 'var(--paper)',
            padding: '9px 18px',
            fontSize: 12.5,
            letterSpacing: '0.04em',
            zIndex: 90,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
