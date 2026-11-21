import { useState } from 'react';
import type { OrderParams } from '../../engine/types.ts';
import { loadSettings } from '../../store/storage.ts';
import { getSecret, migrateLegacySecrets } from '../../store/secrets.ts';
import { aiConfigured, chatText, extractJson } from '../../ai/client.ts';
import { applyPatch, parseOrderText, sanitizePatch } from '../../ai/params.ts';
import { validateParams, type Issue } from '../../engine/validate.ts';
import { profitTiers } from '../../engine/calc.ts';
import { fmtMoney, fmtUnit } from '../utils.ts';

interface Props {
  params: OrderParams;
  onChange: (path: string, value: unknown) => void;
  onClose: () => void;
  onToast: (msg: string) => void;
}

type Mode = 'fill' | 'check' | 'tiers';

const MODES: Array<{ id: Mode; label: string; desc: string }> = [
  { id: 'fill', label: '一句话填参', desc: '描述订单，自动填好全部参数' },
  { id: 'check', label: '成本体检', desc: 'AI 复核参数是否合理' },
  { id: 'tiers', label: '毛利分档', desc: '5% / 10% / 15% 三档报价' },
];

export function AiPanel({ params, onChange, onClose, onToast }: Props) {
  const [mode, setMode] = useState<Mode>('fill');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState('');
  const settings = loadSettings();

  const run = async () => {
    let apiKey = '';
    if (mode !== 'tiers') {
      try {
        await migrateLegacySecrets();
        apiKey = await getSecret('ai', settings.ai.baseUrl);
      } catch (e) {
        onToast(`安全密钥不可用：${e instanceof Error ? e.message : String(e)}`);
      }
    }
    const effectiveCfg = { baseUrl: settings.ai.baseUrl, apiKey, model: settings.ai.model };
    if (mode === 'tiers') {
      const t = profitTiers(params);
      setOutput(
        t
          .map(
            (x) =>
              `利润率 ${x.rate}% → 报价 ¥${fmtMoney(x.finalQuote)}（单本 ¥${fmtUnit(x.unitFinalPrice)}）`,
          )
          .join('\n'),
      );
      return;
    }

    if (mode === 'check') {
      const local: Issue[] = validateParams(params);
      setOutput(local.map((i) => `[${i.level}] ${i.title}：${i.detail}`).join('\n') || '本地体检无异常');
      if (!aiConfigured(effectiveCfg)) {
        onToast('未配置 AI，已用本地规则体检');
        return;
      }
      setBusy(true);
      const r = await chatText(
        effectiveCfg,
        '你是印刷厂成本核算专家。检查线圈本报价参数是否合理，只输出要点，不要客套。',
        JSON.stringify(params),
      );
      setBusy(false);
      if (r.ok) setOutput((prev) => `${prev}\n\n—— AI 复核 ——\n${r.text}`);
      else onToast(`AI 复核失败：${r.message}`);
      return;
    }

    // fill
    if (!text.trim()) {
      onToast('先用一句话描述订单');
      return;
    }
    if (!aiConfigured(effectiveCfg)) {
      const patch = parseOrderText(text);
      const n = applyPatch(patch, params, onChange);
      setOutput(`未配置 AI，已用本地解析填入 ${n} 项参数。如需更准请在设置里配置接口。`);
      onToast(`已按本地规则填入 ${n} 项`);
      return;
    }

    setBusy(true);
    const schema = JSON.stringify({
      orderQty: 1000,
      inner: { len: 0.21, wid: 0.148, gram: 80, ton: 5500, sheets: 80 },
      cover: { gram: 250, laminate: true, foil: false, uv: false },
    });
    const r = await chatText(
      effectiveCfg,
      `你是印刷厂报价助手。把用户描述的线圈本订单转成 JSON 参数。只输出 JSON，不要任何解释。字段参考（数值单位：长度 m、克重 g每平方米、吨价 元每吨、数量 本）：${schema}。可包含 inner/liner/cover/back/gray/misc/profitTax/orderQty，只写你确信的字段。`,
      text,
    );
    setBusy(false);

    if (!r.ok) {
      const patch = parseOrderText(text);
      const n = applyPatch(patch, params, onChange);
      setOutput(`AI 调用失败（${r.message}），已用本地解析填入 ${n} 项。`);
      onToast('AI 不可用，已本地解析');
      return;
    }

    const parsed = extractJson<Record<string, unknown>>(r.text);
    if (!parsed) {
      setOutput(`AI 未返回可识别的 JSON：\n${r.text}`);
      return;
    }

    const patch = sanitizePatch(parsed);
    const count = applyPatch(patch, params, onChange);
    setOutput(`已按 AI 填入 ${count} 项参数：\n${r.text.slice(0, 400)}`);
    onToast(`已填入 ${count} 项参数`);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="AI 助手">
        <div className="sheet-head">
          <span className="sheet-title">
            <span className="bracket">ASSISTANT</span>
            AI 助手
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="sheet-body">
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                className={`btn${mode === m.id ? ' btn-solid' : ''}`}
                onClick={() => {
                  setMode(m.id);
                  setOutput('');
                }}
                style={{ flex: 1, flexDirection: 'column', alignItems: 'flex-start', minHeight: 54 }}
              >
                <span style={{ fontSize: 12.5 }}>{m.label}</span>
                <span style={{ fontSize: 10, opacity: 0.7 }}>{m.desc}</span>
              </button>
            ))}
          </div>

          {mode === 'fill' && (
            <textarea
              className="textarea"
              placeholder="例：A5 线圈本 1000 本，内页 80g 双胶 80 页，封面 250g 铜版覆膜烫金，封底 200g 覆膜"
              value={text}
              onChange={(e) => setText(e.target.value)}
              style={{ minHeight: 110 }}
            />
          )}

          <div className="btn-row" style={{ marginTop: 12 }}>
            <button
              type="button"
              className="btn btn-accent"
              onClick={run}
              disabled={busy}
              style={{ minWidth: 120 }}
            >
              {busy ? 'AI 计算中…' : mode === 'fill' ? '生成并填入' : mode === 'check' ? '体检' : '分档'}
            </button>
            <span className="chip" style={{ alignSelf: 'center' }}>未配置密钥时使用本地规则</span>
          </div>

          {output && (
            <pre
              className="textarea"
              style={{
                marginTop: 14,
                whiteSpace: 'pre-wrap',
                fontSize: 12,
                lineHeight: 1.7,
                minHeight: 120,
                overflow: 'auto',
              }}
            >
              {output}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
