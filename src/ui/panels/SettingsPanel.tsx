import { useEffect, useState } from 'react';
import { getSecret, setSecret, migrateLegacySecrets } from '../../store/secrets.ts';
import { loadSettings, saveSettings, type Settings } from '../../store/storage.ts';
import { pingAi, type AiConfig } from '../../ai/client.ts';

interface Props {
  onClose: () => void;
  onToast: (msg: string) => void;
}

function SettingField({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div className="setting-row">
      <span className="label">{label}</span>
      <div className="field">
        <div className="field-box">
          <input
            type={type}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            style={type === 'password' ? { fontFamily: 'monospace', textAlign: 'left' } : undefined}
          />
        </div>
      </div>
    </div>
  );
}

export function SettingsPanel({ onClose, onToast }: Props) {
  const [s, setS] = useState<Settings>(() => loadSettings());
  const [ping, setPing] = useState('');
  const [saving, setSaving] = useState(false);
  const [secretError, setSecretError] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [ocrKey, setOcrKey] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [aiChanged, setAiChanged] = useState(false);
  const [ocrChanged, setOcrChanged] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        await migrateLegacySecrets();
        const [a, o] = await Promise.all([getSecret('ai', s.ai.baseUrl), getSecret('ocr', s.ocr.cloudBaseUrl)]);
        if (active) { setAiKey(a); setOcrKey(o); setLoaded(true); }
      } catch (e) { if (active) setSecretError(e instanceof Error ? e.message : '系统安全密钥存储不可用'); }
    })();
    return () => { active = false; };
  }, []);

  const setAi = (k: keyof Settings['ai'], v: string) =>
    setS((p) => ({ ...p, ai: { ...p.ai, [k]: v } }));
  const setOcr = (k: keyof Settings['ocr'], v: string) =>
    setS((p) => ({ ...p, ocr: { ...p.ocr, [k]: v } }));

  const doSave = async () => {
    setSaving(true);
    try {
      if (!loaded) throw new Error('安全存储未就绪，无法保存');
      if (aiChanged) await setSecret('ai', s.ai.baseUrl, aiKey);
      if (ocrChanged) await setSecret('ocr', s.ocr.cloudBaseUrl, ocrKey);
      saveSettings({ ...s, ai: { ...s.ai, apiKey: '' }, ocr: { ...s.ocr, cloudApiKey: '' } });
      setAiChanged(false); setOcrChanged(false);
      onToast('设置已保存');
    } catch (e) { setSecretError(e instanceof Error ? e.message : '密钥保存失败'); }
    finally { setSaving(false); }
  };

  const doPing = async () => {
    setPing('测试中…');
    let key = aiKey;
    try { if (!aiChanged) key = await getSecret('ai', s.ai.baseUrl); }
    catch (e) { setPing(`✗ ${e instanceof Error ? e.message : '安全存储不可用'}`); return; }
    const cfg: AiConfig = { baseUrl: s.ai.baseUrl, apiKey: key, model: s.ai.model };
    const r = await pingAi(cfg);
    setPing(r.ok ? `✓ ${r.message} · ${r.ms}ms` : `✗ ${r.message}`);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="设置">
        <div className="sheet-head">
          <span className="sheet-title">
            <span className="bracket">SETTINGS</span>
            设置
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="sheet-body">
          {secretError && <div className="note note-warn">{secretError}</div>}
          <div className="label" style={{ color: 'var(--accent)', marginBottom: 4 }}>
            AI 接口 · OpenAI 兼容
          </div>
          <SettingField
            label="接口地址"
            value={s.ai.baseUrl}
            onChange={(v) => { setAi('baseUrl', v); setAiKey(''); setAiChanged(false); }}
            placeholder="https://token-plan-cn.xiaomimimo.com/v1"
          />
          <SettingField
            label="API Key"
            value={aiKey}
            onChange={(v) => { setAiKey(v); setAiChanged(true); }}
            type="password"
            placeholder="保存于系统安全存储，调用时发送给该服务商"
          />
          <SettingField
            label="模型"
            value={s.ai.model}
            onChange={(v) => setAi('model', v)}
            placeholder="mimo-v2.6-flash"
          />
          <div className="setting-row">
            <span className="label">连通性</span>
            <div style={{ flex: 1, paddingTop: 6 }}>
              <button type="button" className="btn" onClick={doPing}>
                测试连接
              </button>
              {ping && (
                <div
                  className={`note ${ping.startsWith('✓') ? 'note-info' : 'note-warn'}`}
                  style={{ paddingTop: 8 }}
                >
                  <span className="note-mark" />
                  <span>{ping}</span>
                </div>
              )}
            </div>
          </div>

          <hr className="hair" style={{ margin: '18px 0' }} />

          <div className="label" style={{ color: 'var(--accent)', marginBottom: 4 }}>
            识图 · 云端视觉
          </div>
          <div className="setting-row">
            <span className="label">识图方式</span>
            <div className="field">
              <div className="field-box">
                <select
                  value={s.ocr.mode}
                  onChange={(e) => setOcr('mode', e.target.value as 'local' | 'cloud')}
                >
                  <option value="local">本地识别（tesseract，语言包内置）</option>
                  <option value="cloud">云端视觉识别（需配置，更准）</option>
                </select>
              </div>
            </div>
          </div>
          {s.ocr.mode === 'cloud' && (
            <>
              <SettingField
                label="视觉接口"
                value={s.ocr.cloudBaseUrl}
                onChange={(v) => { setOcr('cloudBaseUrl', v); setOcrKey(''); setOcrChanged(false); }}
                placeholder="https://token-plan-cn.xiaomimimo.com/v1"
              />
              <SettingField
                label="视觉 Key"
                value={ocrKey}
                onChange={(v) => { setOcrKey(v); setOcrChanged(true); }}
                type="password"
                placeholder="独立配置视觉服务密钥"
              />
              <SettingField
                label="视觉模型"
                value={s.ocr.cloudModel}
                onChange={(v) => setOcr('cloudModel', v)}
                placeholder="mimo-v2.6-pro"
              />
            </>
          )}

          <div className="note" style={{ marginTop: 16 }}>
            <span className="note-mark" />
            <span>
              密钥使用系统安全存储，并绑定对应接口地址；不可用时禁止保存。AI 和云端识图请求会将密钥发送给所配置的服务商。
            </span>
          </div>
        </div>

        <div className="sheet-foot">
          <button type="button" className="btn btn-solid" onClick={doSave} disabled={saving}>
            {saving ? '已保存' : '保存设置'}
          </button>
        </div>
      </div>
    </div>
  );
}
