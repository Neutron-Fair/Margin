import type { ModuleDef } from './schema.ts';
import type { OrderParams } from '../engine/types.ts';
import { Field } from './Field.tsx';
import { getPath } from './utils.ts';

interface ModuleSectionProps {
  def: ModuleDef;
  params: OrderParams;
  /** 模块每本成本摘要（由 App 计算） */
  summary: string;
  /** 底部补充数据（印张、印次、覆膜等） */
  footExtra?: string[];
  open: boolean;
  onToggle: () => void;
  onChange: (path: string, value: unknown) => void;
  onValidityChange: (path: string, valid: boolean) => void;
}

export function ModuleSection({
  def,
  params,
  summary,
  footExtra,
  open,
  onToggle,
  onChange,
  onValidityChange,
}: ModuleSectionProps) {
  return (
    <section className={`module${open ? ' is-open' : ''}`} id={`module-${def.id}`}>
      <button
        type="button"
        className="module-head"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`module-body-${def.id}`}
      >
        <span className="module-no num">{def.no}</span>
        <span className="module-name">
          {def.name}
          <span className="module-desc">{def.desc}</span>
        </span>
        <span className="module-cost">
          <span className="per-book num">{summary}</span>
        </span>
        <span className="module-chevron" aria-hidden="true" />
      </button>

      <div className="module-body" id={`module-body-${def.id}`}>
        <div className="module-body-inner">
          <div className="module-fields">
            {def.fields.map((f) => (
              <Field key={f.path} def={f} value={getPath(params, f.path)} onChange={onChange} onValidityChange={onValidityChange} />
            ))}
          </div>

          {def.process && (
            <div className="process-strip">
              {def.process.map((p) => {
                const checked = Boolean(getPath(params, p.path));
                return (
                  <div className="process-item" key={p.path}>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => onChange(p.path, e.target.checked)}
                      />
                      <span className="check-text">{p.label}</span>
                    </label>
                    {p.pricePath && checked && (
                      <Field
                        def={{
                          path: p.pricePath,
                          label: p.priceLabel ?? '单价',
                          unit: p.priceUnit,
                          step: p.priceStep ?? 0.01,
                          digits: p.priceDigits ?? 3,
                        }}
                        value={getPath(params, p.pricePath)}
                        onChange={onChange}
                        onValidityChange={onValidityChange}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="module-foot">
            {footExtra && footExtra.length > 0 && (
              <>
                {footExtra.map((t, i) => (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                    {i > 0 && <span className="sep" />}
                    <span>{t}</span>
                  </span>
                ))}
                <span className="sep" />
              </>
            )}
            <span>{def.footNote}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
