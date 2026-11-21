import { useState } from 'react';
import type { OrderParams } from '../../engine/types.ts';
import { loadSettings } from '../../store/storage.ts';
import { getSecret, migrateLegacySecrets } from '../../store/secrets.ts';
import { aiConfigured, chatVision } from '../../ai/client.ts';
import { pickImage } from '../../export/files.ts';
import { applyPatch, parseOrderText } from '../../ai/params.ts';

interface Props {
  params: OrderParams;
  onChange: (path: string, value: unknown) => void;
  onClose: () => void;
  onToast: (msg: string) => void;
}

export function OcrPanel({ params, onChange, onClose, onToast }: Props) {
  const [img, setImg] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState('');
  const settings = loadSettings();

  const doLocalOcr = async (dataUrl: string) => {
    setBusy(true);
    setLog('正在加载本地识别引擎…');
    try {
      const Tesseract = (await import('tesseract.js')).default as unknown as {
        createWorker: (lang?: string, oem?: number, opts?: unknown) => Promise<{
          recognize: (d: string) => Promise<{ data: { text: string } }>;
          terminate: () => Promise<void>;
        }>;
      };
      // 引擎与语言包全部随包内置，不依赖任何 CDN
      const abs = (p: string) => new URL(p, document.baseURI).href;
      const hasSimd = (() => {
        try {
          return WebAssembly.validate(
            new Uint8Array([
              0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65,
              0, 253, 15, 253, 98, 11,
            ]),
          );
        } catch {
          return false;
        }
      })();
      const worker = await Tesseract.createWorker('chi_sim', 1, {
        logger: (m: { status: string; progress: number }) => {
          if (m.status && m.progress !== undefined) {
            setLog(`${m.status} ${(m.progress * 100).toFixed(0)}%`);
          }
        },
        workerPath: abs('tess/worker.min.js'),
        // 精确文件（以 .js 结尾）时 tesseract 直接用该文件，不做变体探测
        corePath: abs(
          hasSimd ? 'tess/tesseract-core-simd-lstm.wasm.js' : 'tess/tesseract-core-lstm.wasm.js',
        ),
        langPath: abs('ocr'),
        lstmOnly: true,
      });
      const r = await worker.recognize(dataUrl);
      await worker.terminate();
      setText(r.data.text);
      setLog('本地识别完成');
    } catch (e) {
      setLog(`本地识别失败：${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  const doCloudOcr = async (dataUrl: string) => {
    const baseUrl = settings.ocr.cloudBaseUrl;
    let apiKey = '';
    try {
      await migrateLegacySecrets();
      apiKey = await getSecret('ocr', baseUrl);
    } catch (e) {
      setLog(`安全密钥不可用：${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const cfg = { baseUrl, apiKey, model: settings.ocr.cloudModel };
    if (!aiConfigured(cfg)) {
      setLog('云端识别未配置：请到「设置」填入视觉接口与密钥');
      return;
    }
    setBusy(true);
    setLog(`云端识别中（${cfg.model}）…`);
    const r = await chatVision(
      cfg,
      '你是订单单/规格表识别助手。把图片里的印刷订单参数完整提取为纯文本，保留数字与单位，不要遗漏，不要编造。',
      dataUrl,
      '请提取图片中所有文字与参数',
      { maxTokens: 1200 },
    );
    setBusy(false);
    if (r.ok) {
      setText(r.text);
      setLog('云端识别完成');
    } else {
      setLog(`云端识别失败：${r.message}`);
    }
  };

  const doRecognize = async () => {
    if (!img) {
      onToast('先选择一张图片');
      return;
    }
    if (settings.ocr.mode === 'cloud') await doCloudOcr(img);
    else await doLocalOcr(img);
  };

  const doApply = () => {
    if (!text.trim()) {
      onToast('没有可应用的识别文本');
      return;
    }
    const patch = parseOrderText(text);
    const count = applyPatch(patch, params, onChange);
    onToast(`已应用 ${count} 项参数`);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="识图录入">
        <div className="sheet-head">
          <span className="sheet-title">
            <span className="bracket">CAPTURE</span>
            文本识图
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="sheet-body">
          <div className="btn-row">
            <button
              type="button"
              className="btn"
              onClick={async () => {
                const d = await pickImage();
                if (d) {
                  setImg(d);
                  setText('');
                  setLog('已选择图片');
                }
              }}
            >
              选择订单单 / 规格表
            </button>
            <button
              type="button"
              className="btn btn-accent"
              onClick={doRecognize}
              disabled={!img || busy}
            >
              {busy ? '识别中…' : '开始识别'}
            </button>
            <span className="chip" style={{ alignSelf: 'center' }}>
              当前：{settings.ocr.mode === 'cloud' ? '云端视觉' : '本地识别'}
            </span>
          </div>

          {img && (
            <img
              src={img}
              alt="待识别图片"
              style={{
                width: '100%',
                maxHeight: 180,
                objectFit: 'contain',
                marginTop: 12,
                border: '1px solid var(--hair)',
                background: 'var(--field-bg)',
              }}
            />
          )}

          {log && (
            <div className="note note-info" style={{ paddingTop: 10 }}>
              <span className="note-mark" />
              <span>{log}</span>
            </div>
          )}

          <textarea
            className="textarea"
            style={{ marginTop: 12, minHeight: 130 }}
            placeholder="识别结果会出现在这里，也可以手动粘贴/修改。确认无误后点「应用到参数」。"
            value={text}
            onChange={(e) => setText(e.target.value)}
          />

          <div className="note" style={{ paddingTop: 10 }}>
            <span className="note-mark" />
            <span>
              识别出的文本会按「数量 / 尺寸 / 克重 / 覆膜 / 烫金 / UV」等关键词解析填参。
              本地识别在设备内完成、语言包内置（识别引擎首次使用需联网加载，之后复用缓存）；
              云端识别需在设置里配置，识别更准、支持复杂排版。
            </span>
          </div>
        </div>

        <div className="sheet-foot">
          <button type="button" className="btn btn-solid" onClick={doApply} disabled={!text.trim()}>
            应用到参数
          </button>
        </div>
      </div>
    </div>
  );
}
