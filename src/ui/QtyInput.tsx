import { useEffect, useRef, useState } from 'react';

interface Props {
  value: number;
  onChange: (n: number) => void;
  onValidityChange?: (path: string, valid: boolean) => void;
}

/**
 * 订单数量输入：允许清空重输，不把空输入强行变成 0/1。
 * 内部保留字符串草稿，只有解析出正数才提交；失焦时归位。
 */
export function QtyInput({ value, onChange, onValidityChange }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => String(value));

  useEffect(() => {
    if (document.activeElement === ref.current) return;
    const cur = Number.parseFloat(text);
    if (!Number.isFinite(cur) || Math.abs(cur - value) > 1e-9) setText(String(value));
    // 只在外部值变化时同步，输入中不打断
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return (
    <input
      ref={ref}
      type="text"
      inputMode="numeric"
      aria-label="订单数量"
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        // 清空是重输的中间态：沿用上一个有效数量，不锁死报价（见 Field.tsx 同处说明）
        if (raw.trim() === '') {
          onValidityChange?.('orderQty', true);
          return;
        }
        const n = Number(raw);
        const valid = /^\d+$/.test(raw) && Number.isSafeInteger(n) && n > 0;
        onValidityChange?.('orderQty', valid);
        if (valid) onChange(n);
      }}
      onBlur={() => {
        setText(String(value));
        onValidityChange?.('orderQty', true);
      }}
      style={{ textAlign: 'left' }}
    />
  );
}
