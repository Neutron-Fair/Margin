import { useState } from 'react';
import type { OrderParams, OrderResult } from '../../engine/types.ts';
import type { DocMeta } from '../../store/storage.ts';
import { canvasToDataUrl, renderQuoteCanvas } from '../../export/quoteImage.ts';
import { savePng } from '../../export/files.ts';
import { fmtUnit } from '../utils.ts';

interface Props {
  params: OrderParams;
  result: OrderResult;
  doc: DocMeta;
  onClose: () => void;
  onToast: (msg: string) => void;
}

function printImage(dataUrl: string) {
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const d = iframe.contentDocument;
  if (!d) {
    iframe.remove();
    return false;
  }
  d.open();
  d.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>报价单</title><style>@page{size:A4;margin:0}html,body{margin:0;padding:0}img{width:100%;display:block}</style></head><body><img src="${dataUrl}"></body></html>`,
  );
  d.close();
  setTimeout(() => {
    try {
      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch {
      /* 用户可改用下载 */
    }
    setTimeout(() => iframe.remove(), 1500);
  }, 250);
  return true;
}

export function QuoteSheet({ params, result, doc, onClose, onToast }: Props) {
  const [url] = useState(() => {
    try {
      return canvasToDataUrl(renderQuoteCanvas({ doc, params, result }));
    } catch (e) {
      console.error(e);
      return '';
    }
  });

  const filename = `报价单-${doc.no || doc.date || 'draft'}.png`;

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="sheet"
        style={{ maxWidth: 760 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="报价单预览"
      >
        <div className="sheet-head">
          <span className="sheet-title">
            <span className="bracket">QUOTATION</span>
            报价单
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </div>

        <div className="sheet-body" style={{ background: 'var(--paper-sunken)', padding: 16 }}>
          {url ? (
            <img
              src={url}
              alt="报价单预览"
              style={{ width: '100%', display: 'block', border: '1px solid var(--hair-strong)' }}
            />
          ) : (
            <div className="empty">报价单生成失败，请检查浏览器是否支持 Canvas</div>
          )}
          <div
            style={{
              marginTop: 10,
              fontSize: 11,
              color: 'var(--ink-2)',
              display: 'flex',
              justifyContent: 'space-between',
            }}
          >
            <span>A4 竖版 · 2480×3508 像素 · 单本 ¥{fmtUnit(result.unitFinalPrice)}</span>
            <span>可直接发微信 / 打印</span>
          </div>
        </div>

        <div className="sheet-foot">
          <button type="button" className="btn" onClick={() => printImage(url)} disabled={!url}>
            打印
          </button>
          <button
            type="button"
            className="btn btn-accent"
            disabled={!url}
            onClick={async () => {
              const msg = await savePng(url, filename);
              onToast(msg);
            }}
          >
            保存图片
          </button>
        </div>
      </div>
    </div>
  );
}
