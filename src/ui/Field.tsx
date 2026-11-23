import { useEffect, useRef, useState } from 'react';
import type { FieldDef } from './schema.ts';
import { fmtInput } from './utils.ts';

interface FieldProps {
  def: FieldDef;
  value: unknown;
  onChange: (path: string, value: unknown) => void;
  onValidityChange?: (path: string, valid: boolean) => void;
}

export function Field({ def, value, onChange, onValidityChange }: FieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(() => fmtInput(Number(value)));

  // 外部改值（载入方案/预设/AI 填参）时同步显示；正在输入时不动，避免打断小数点
  useEffect(() => {
    const v = Number(value);
    if (!Number.isFinite(v)) return;
    const cur = Number.parseFloat(text);
    if (!Number.isFinite(cur) || Math.abs(cur - v) > 1e-9) {
      if (document.activeElement !== inputRef.current) setText(fmtInput(v));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  if (def.kind === 'select') {
    const current = String(value ?? '');
    return (
      <div className={`field${def.span === 2 ? ' field-span2' : ''}`}>
        <span className="field-label">
          <span>{def.label}</span>
          {def.unit ? <span className="field-unit">{def.unit}</span> : null}
        </span>
        <div className="field-box">
          <select value={current} onChange={(e) => onChange(def.path, e.target.value)}>
            {(def.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>
    );
  }

  return (
    <div className={`field${def.span === 2 ? ' field-span2' : ''}`}>
      <span className="field-label">
        <span>{def.label}</span>
        {def.unit ? <span className="field-unit">{def.unit}</span> : null}
      </span>
      <div className="field-box">
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          value={text}
          aria-label={def.label}
          onChange={(e) => {
            const raw = e.target.value;
            setText(raw);
            const trimmed = raw.trim();
            /*
             * 清空是「正在重输」的中间态：不提交新值，也不把报价锁死。
             *
             * 2026-11-23 修正：以前空字符串被判为无效输入 → 整页暂停报价，
             * 而且「清空 → 再填有效值」会触发回退提示，必须手动点「已核对数值」
             * 才能恢复。用户视角就是「我把一个数删掉，报价就卡住 / 算错了」。
             * 现在空的字段沿用上一个有效值继续算，失焦时再把显示归位。
             */
            if (trimmed === '') {
              onValidityChange?.(def.path, true);
              return;
            }
            const n = Number(trimmed);
            const min = def.min ?? (def.path.endsWith('.imposition') ? 1 : 0);
            const integer = /\.(sheets|sheetsPerBook|imposition|wasteSheets|coilsPerBook)$/.test(def.path);
            const valid = /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(trimmed) && Number.isFinite(n) && n >= min && (!integer || Number.isSafeInteger(n));
            onValidityChange?.(def.path, valid);
            if (valid) onChange(def.path, n);
          }}
          onBlur={() => {
            const n = Number(value);
            setText(fmtInput(Number.isFinite(n) ? n : 0));
            onValidityChange?.(def.path, true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              const step = def.step ?? 1;
              const n = Number(value);
              const min = def.min ?? (def.path.endsWith('.imposition') ? 1 : 0);
              const next = Math.max(min, (Number.isFinite(n) ? n : min) + (e.key === 'ArrowUp' ? step : -step));
              const rounded = Number(next.toFixed(def.digits ?? 4));
              setText(fmtInput(rounded));
              onValidityChange?.(def.path, true);
              onChange(def.path, rounded);
            }
          }}
        />
      </div>
    </div>
  );
}
