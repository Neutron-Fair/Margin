import { useMemo, useState } from 'react';
import type { OrderParams } from '../../engine/types.ts';
import { validateParams, ISSUE_LABEL, type Issue } from '../../engine/validate.ts';
import { calcOrder } from '../../engine/calc.ts';
import { fmtMoney, fmtUnit } from '../utils.ts';
import { loadSettings } from '../../store/storage.ts';
import { getSecret, migrateLegacySecrets } from '../../store/secrets.ts';
import { aiConfigured, chatText } from '../../ai/client.ts';

interface Props {
  params: OrderParams;
  onClose: () => void;
  onToast: (msg: string) => void;
}

export function CheckPanel({ params, onClose, onToast }: Props) {
  const [aiText, setAiText] = useState('');
  const [busy, setBusy] = useState(false);
  const issues = useMemo(() => validateParams(params), [params]);
  const r = useMemo(() => calcOrder(params), [params]);
  const settings = loadSettings();

  const grouped: Record<Issue['level'], Issue[]> = {
    error: issues.filter((i) => i.level === 'error'),
    warn: issues.filter((i) => i.level === 'warn'),
    info: issues.filter((i) => i.level === 'info'),
  };

  const runAi = async () => {
    let apiKey = '';
    try {
      await migrateLegacySecrets();
      apiKey = await getSecret('ai', settings.ai.baseUrl);
    } catch (e) {
      onToast(`安全密钥不可用：${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const cfg = { baseUrl: settings.ai.baseUrl, apiKey, model: settings.ai.model };
    if (!aiConfigured(cfg)) {
      onToast('未配置 AI，可在设置里填入接口');
      return;
    }
    setBusy(true);
    const res = await chatText(
      cfg,
      '你是印刷厂成本核算专家。复核这份报价参数是否合理，指出可能的报价风险与改进建议，分条列点，简洁。',
      JSON.stringify({ params, costTotal: r.costTotal, unitFinal: r.unitFinalPrice }),
    );
    setBusy(false);
    if (res.ok) setAiText(res.text);
    else onToast(`AI 复核失败：${res.message}`);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="成本体检">
        <div className="sheet-head">
          <span className="sheet-title">
            <span className="bracket">CHECK</span>
            成本体检
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="sheet-body">
          <div style={{ display: 'flex', gap: 18, marginBottom: 12, alignItems: 'flex-end' }}>
            <div>
              <span className="label">单本含税价</span>
              <div className="result-amount" style={{ fontSize: 34 }}>
                <span className="cny">¥</span>
                {fmtUnit(r.unitFinalPrice)}
              </div>
            </div>
            <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
              <span className="label">发现 {issues.length} 条</span>
              <div className="num" style={{ fontSize: 15 }}>
                <span style={{ color: 'var(--neg)' }}>{grouped.error.length} 严重</span>
                <span style={{ color: 'var(--ink-2)' }}> · {grouped.warn.length} 建议</span>
                <span style={{ color: 'var(--ink-3)' }}> · {grouped.info.length} 提示</span>
              </div>
            </div>
          </div>

          <hr className="hair-strong" />

          {issues.length === 0 && (
            <div className="empty">参数体检通过，未发现明显异常。</div>
          )}

          {(['error', 'warn', 'info'] as const).map((lv) =>
            grouped[lv].length > 0 ? (
              <div key={lv} style={{ marginTop: 12 }}>
                <div className="label" style={{ marginBottom: 4, color: lv === 'error' ? 'var(--accent)' : 'var(--ink-2)' }}>
                  {ISSUE_LABEL[lv]}
                </div>
                {grouped[lv].map((i) => (
                  <div className={`issue is-${i.level}`} key={i.code} style={{ padding: '7px 0' }}>
                    <span className="issue-dot" />
                    <span>
                      <strong>{i.title}</strong>
                      <br />
                      {i.detail}
                      {i.hint && (
                        <span style={{ color: 'var(--ink-3)' }}>
                          <br />
                          {i.hint}
                        </span>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : null,
          )}

          <div style={{ marginTop: 18 }}>
            <button type="button" className="btn btn-accent" onClick={runAi} disabled={busy}>
              {busy ? 'AI 复核中…' : '让 AI 复核一遍'}
            </button>
          </div>

          {aiText && (
            <pre
              className="textarea"
              style={{ marginTop: 12, whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.7 }}
            >
              {aiText}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
