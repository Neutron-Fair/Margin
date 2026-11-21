import type { OrderParams, OrderResult } from '../engine/types.ts';
import type { DocMeta } from '../store/storage.ts';
import { fmtMoney, fmtUnit } from '../ui/utils.ts';

const SERIF = '"Songti SC","SimSun","Noto Serif CJK SC",serif';
const SANS = '"PingFang SC","Microsoft YaHei","Noto Sans CJK SC",sans-serif';

const INK = '#2A2A28';
const INK2 = '#7C7B76';
const INK3 = '#A9A79F';
const HAIR = '#D9D6CD';
const HAIR_STRONG = '#C3BFB3';
const ACCENT = '#C7322E';
const PAPER = '#F4F2EC';

interface TextOpts {
  size?: number;
  font?: string;
  color?: string;
  align?: CanvasTextAlign;
  weight?: string;
  ls?: number;
}

function drawText(
  g: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  o: TextOpts = {},
) {
  g.save();
  g.fillStyle = o.color ?? INK;
  g.textAlign = o.align ?? 'left';
  g.font = `${o.weight ?? '400'} ${o.size ?? 14}px ${o.font ?? SANS}`;
  // Chromium 99+ 支持 canvas letterSpacing
  try {
    (g as unknown as { letterSpacing: string }).letterSpacing = `${o.ls ?? 0}px`;
  } catch {
    /* 老环境忽略 */
  }
  g.fillText(s, x, y);
  g.restore();
}

function line(g: CanvasRenderingContext2D, x1: number, y: number, x2: number, color = HAIR) {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(x1, y + 0.5);
  g.lineTo(x2, y + 0.5);
  g.stroke();
  g.restore();
}

const mm = (v: number) => Math.round(v * 1000);

function specOf(id: string, p: OrderParams): string {
  switch (id) {
    case 'inner':
      return `${mm(p.inner.len)}×${mm(p.inner.wid)}mm · ${p.inner.gram}g · ${p.inner.sheets}张 · ${p.inner.printSide === 'double' ? '双面' : '单面'}`;
    case 'liner':
      return `${mm(p.liner.len)}×${mm(p.liner.wid)}mm · ${p.liner.gram}g · ${p.liner.sheets}张 · ${p.liner.printSide === 'double' ? '双面' : '单面'}`;
    case 'cover': {
      const proc = [
        p.cover.laminate ? '覆膜' : '',
        p.cover.foil ? '烫金' : '',
        p.cover.uv ? 'UV' : '',
      ]
        .filter(Boolean)
        .join('/');
      return `${mm(p.cover.len)}×${mm(p.cover.wid)}mm · ${p.cover.gram}g · ${p.cover.printSide === 'double' ? '双面' : '单面'}${proc ? ' · ' + proc : ''}`;
    }
    case 'back': {
      const proc = [
        p.back.laminate ? '覆膜' : '',
        p.back.foil ? '烫金' : '',
        p.back.uv ? 'UV' : '',
      ]
        .filter(Boolean)
        .join('/');
      return `${mm(p.back.len)}×${mm(p.back.wid)}mm · ${p.back.gram}g · ${p.back.printSide === 'double' ? '双面' : '单面'}${proc ? ' · ' + proc : ''}`;
    }
    case 'gray':
      return `${mm(p.gray.len)}×${mm(p.gray.wid)}mm · ${p.gray.gram}g · ${p.gray.sheetsPerBook}块`;
    default:
      return '';
  }
}

export interface QuotePayload {
  doc: DocMeta;
  params: OrderParams;
  result: OrderResult;
}

/** 生成 A4 竖版报价单（1240×1754 @2x） */
export function renderQuoteCanvas({ doc, params, result: r }: QuotePayload): HTMLCanvasElement {
  const shipping = Number.isFinite(params.shippingFee) ? Math.max(0, params.shippingFee!) : 0;
  const payable = r.finalQuote + shipping;
  const W = 1240;
  const H = 1754;
  const S = 2;
  const cv = document.createElement('canvas');
  cv.width = W * S;
  cv.height = H * S;
  const g = cv.getContext('2d');
  if (!g) throw new Error('canvas 2d 不可用');
  g.scale(S, S);

  const M = 76;
  const R = W - M;

  // 纸底
  g.fillStyle = PAPER;
  g.fillRect(0, 0, W, H);

  // 页眉
  drawText(g, 'COIL BOOK · COST SYSTEM', M, 86, {
    size: 11,
    color: ACCENT,
    ls: 2.6,
    weight: '500',
  });
  line(g, M, 100, R, HAIR_STRONG);

  drawText(g, '报价单', M, 158, { size: 46, font: SERIF, ls: 4 });
  drawText(g, 'QUOTATION', M + 168, 158, { size: 12, color: INK3, ls: 3.4, font: SANS });

  // 右上：单号 / 日期
  const metaX = R;
  drawText(g, '单号', metaX - 300, 108, { size: 10.5, color: INK3, ls: 1.6 });
  drawText(g, doc.no || '—', metaX, 108, { size: 13, align: 'right', font: SERIF });
  drawText(g, '日期', metaX - 300, 132, { size: 10.5, color: INK3, ls: 1.6 });
  drawText(g, doc.date || '—', metaX, 132, { size: 13, align: 'right', font: SERIF });
  drawText(g, '客户', metaX - 300, 156, { size: 10.5, color: INK3, ls: 1.6 });
  drawText(g, doc.client || '—', metaX, 156, { size: 13, align: 'right', font: SERIF });

  line(g, M, 190, R, HAIR_STRONG);

  // 订单摘要
  drawText(g, '订单数量', M, 222, { size: 10.5, color: INK3, ls: 1.6 });
  drawText(g, `${params.orderQty} 本`, M, 250, { size: 24, font: SERIF });
  drawText(g, '单本含税价', M + 230, 222, { size: 10.5, color: INK3, ls: 1.6 });
  drawText(g, `¥ ${fmtUnit(r.unitFinalPrice)}`, M + 230, 250, {
    size: 24,
    font: SERIF,
    color: ACCENT,
  });
  if (doc.note) {
    drawText(g, '备注 / 工艺说明', M + 520, 222, { size: 10.5, color: INK3, ls: 1.6 });
    const note = doc.note.length > 30 ? doc.note.slice(0, 30) + '…' : doc.note;
    drawText(g, note, M + 520, 250, { size: 14 });
  }

  line(g, M, 278, R, HAIR);

  // 表头
  const y0 = 316;
  drawText(g, '项目', M, y0, { size: 10.5, color: INK3, ls: 2 });
  drawText(g, '规格', M + 120, y0, { size: 10.5, color: INK3, ls: 2 });
  drawText(g, '金额', R, y0, { size: 10.5, color: INK3, ls: 2, align: 'right' });
  line(g, M, y0 + 12, R, HAIR_STRONG);

  const rows: Array<{ no: string; name: string; spec: string; value: number; muted?: boolean }> = [
    { no: '01', name: '内页', spec: specOf('inner', params), value: r.modules.inner.orderTotal },
    { no: '02', name: '衬纸', spec: specOf('liner', params), value: r.modules.liner.orderTotal },
    { no: '03', name: '封面', spec: specOf('cover', params), value: r.modules.cover.orderTotal },
    { no: '04', name: '封底', spec: specOf('back', params), value: r.modules.back.orderTotal },
    { no: '05', name: '灰板', spec: specOf('gray', params), value: r.modules.gray.orderTotal },
    {
      no: '06',
      name: '线圈',
      spec: `${params.misc.coilPrice} 元/个 × ${params.misc.coilsPerBook} × ${params.orderQty}`,
      value: r.misc.coilTotal,
    },
    {
      no: '07',
      name: '装订',
      spec: `${params.misc.bindingFee} 元/本`,
      value: r.misc.bindingTotal,
    },
    {
      no: '08',
      name: '包装',
      spec: `${params.misc.packagingFee} 元/本`,
      value: r.misc.packTotal,
    },
    { no: '09', name: '固定杂费', spec: '模具 / 版费等一次性费用', value: r.misc.fixed },
    {
      no: '10',
      name: '订单损耗',
      spec: `${params.misc.wasteRate}%`,
      value: r.wasteAmount,
    },
  ];

  let y = y0 + 44;
  const rowH = 40;
  for (const row of rows) {
    drawText(g, row.no, M, y, { size: 11, color: INK3, font: SERIF });
    drawText(g, row.name, M + 34, y, { size: 15, font: SERIF });
    drawText(g, row.spec, M + 120, y, { size: 12, color: INK2 });
    drawText(g, `¥ ${fmtMoney(row.value)}`, R, y, {
      size: 14,
      align: 'right',
      font: SERIF,
    });
    line(g, M, y + 13, R, HAIR);
    y += rowH;
  }

  // 成本合计
  y += 8;
  line(g, M, y, R, HAIR_STRONG);
  drawText(g, '订单总成本', M, y + 30, { size: 14, font: SERIF });
  drawText(g, `¥ ${fmtMoney(r.costTotal)}`, R, y + 30, { size: 17, align: 'right', font: SERIF });
  drawText(g, `单本成本 ¥ ${fmtUnit(r.unitCost)}`, R - 190, y + 30, {
    size: 11.5,
    color: INK2,
    align: 'right',
  });

  y += 56;
  drawText(g, '利润', M, y, { size: 12, color: INK2 });
  drawText(g, `${params.profitTax.profitRate}%`, M + 60, y, { size: 12, color: INK2 });
  drawText(g, `¥ ${fmtMoney(r.profitAmount)}`, R, y, { size: 13, align: 'right', font: SERIF });

  y += 26;
  drawText(g, '税额', M, y, { size: 12, color: INK2 });
  drawText(g, `${params.profitTax.taxRate}%`, M + 60, y, { size: 12, color: INK2 });
  drawText(g, `¥ ${fmtMoney(r.taxAmount)}`, R, y, { size: 13, align: 'right', font: SERIF });

  // 最终报价块
  y += 34;
  const boxH = 118;
  g.save();
  g.fillStyle = 'rgba(199,50,46,0.05)';
  g.fillRect(M, y, R - M, boxH);
  g.strokeStyle = ACCENT;
  g.lineWidth = 1;
  g.strokeRect(M + 0.5, y + 0.5, R - M - 1, boxH - 1);
  g.restore();

  drawText(g, '最终报价（含利润与税）', M + 26, y + 34, { size: 11, color: ACCENT, ls: 1.6 });
  drawText(g, `¥ ${fmtMoney(r.finalQuote)}`, M + 26, y + 78, { size: 34, font: SERIF });
  drawText(g, '单本含税价（不含运）', R - 26, y + 34, { size: 11, color: ACCENT, ls: 1.6, align: 'right' });
  drawText(g, `¥ ${fmtUnit(r.unitFinalPrice)}`, R - 26, y + 78, {
    size: 30,
    font: SERIF,
    align: 'right',
    color: ACCENT,
  });

  y += boxH + 35;
  drawText(g, '运费（不计入成本、利润及税）', M, y, { size: 13, color: INK2 });
  drawText(g, `¥ ${fmtMoney(shipping)}`, R, y, { size: 14, align: 'right', font: SERIF });
  y += 34;
  drawText(g, '含运应付总额', M, y, { size: 16, font: SERIF });
  drawText(g, `¥ ${fmtMoney(payable)}`, R, y, { size: 18, align: 'right', font: SERIF });
  y += 30;
  drawText(g, '单本到货价', M, y, { size: 13, color: INK2 });
  drawText(g, `¥ ${fmtUnit(payable / r.orderQty)}`, R, y, { size: 15, align: 'right', font: SERIF });

  // 脚注
  const fy = H - 150;
  line(g, M, fy, R, HAIR);
  drawText(g, '计价口径', M, fy + 26, { size: 10.5, color: INK3, ls: 2 });
  const notes = [
    '纸张：长×宽×克重×吨价÷1,000,000 = 单张价；每本用纸 = 单张价×每本张数×(1+纸张损耗)。',
    '印工：拼版印张 = ⌈订单数×每本张数÷拼版数⌉ + 备损张数，双面按两倍印次；再加一次上机费。',
    '后工艺：覆膜 = 长×宽×0.38×订单数×1.1（不足 60 元按 60 元）；烫金 / UV = 订单数÷拼版数×单价。',
    '利润与税均以订单总成本为基数上浮。最终报价不含运费；运费单列，不计利润与税。',
  ];
  notes.forEach((t, i) => {
    drawText(g, t, M, fy + 48 + i * 18, { size: 10.5, color: INK2 });
  });

  drawText(g, '本报价单由「线圈本成本核算」生成', R, H - 26, {
    size: 10,
    color: INK3,
    align: 'right',
    ls: 0.6,
  });

  return cv;
}

export function canvasToDataUrl(cv: HTMLCanvasElement): string {
  return cv.toDataURL('image/png');
}
