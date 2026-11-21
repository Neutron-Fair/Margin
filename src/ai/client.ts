/**
 * OpenAI 兼容接口客户端
 * 支持 /chat/completions（文本）与视觉消息（图片 base64）
 * 只在用户主动点击时联网；密钥由调用方从系统安全存储读取
 */

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

export interface AiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface AiError {
  ok: false;
  message: string;
}

const normalizeBase = (url: string): string => {
  let u = (url ?? '').trim();
  if (!u) return '';
  u = u.replace(/\/+$/, '');
  // 允许用户填到 /v1 或 /chat/completions 都行
  u = u.replace(/\/chat\/completions$/, '');
  if (!/\/v\d+$/.test(u)) u = `${u}/v1`;
  return u;
};

export function aiConfigured(cfg: AiConfig): boolean {
  return Boolean(cfg.baseUrl?.trim() && cfg.model?.trim() && cfg.apiKey?.trim());
}

async function requestChat(
  cfg: AiConfig,
  messages: AiChatMessage[],
  opts: { maxTokens?: number; temperature?: number; timeoutMs?: number } = {},
): Promise<{ ok: true; text: string; usage?: unknown } | AiError> {
  const base = normalizeBase(cfg.baseUrl);
  if (!base) return { ok: false, message: '未配置接口地址' };
  try {
    const u = new URL(base);
    if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) throw new Error();
  } catch { return { ok: false, message: '接口地址必须为无凭据的 HTTPS 地址' }; }
  if (!cfg.apiKey?.trim()) return { ok: false, message: '未配置 API Key' };

  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 45000);

  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: cfg.model.trim(),
        messages,
        temperature: opts.temperature ?? 0.3,
        max_tokens: opts.maxTokens ?? 1200,
        stream: false,
      }),
      signal: ctrl.signal,
      redirect: 'error',
    });

    const text = await res.text();
    if (!res.ok) {
      let msg = `接口返回 ${res.status}`;
      try {
        const j = JSON.parse(text);
        msg = j?.error?.message ?? msg;
      } catch {
        /* 保底 */
      }
      return { ok: false, message: msg };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return { ok: false, message: '响应不是合法 JSON' };
    }

    const choices = (parsed as { choices?: Array<{ message?: { content?: string } }> })?.choices;
    const content = choices?.[0]?.message?.content;
    if (typeof content !== 'string') return { ok: false, message: '响应缺少文本内容' };
    return { ok: true, text: content, usage: (parsed as { usage?: unknown })?.usage };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, message: /abort/i.test(msg) ? '请求超时' : msg };
  } finally {
    clearTimeout(timeout);
  }
}

/** 测试连接：只问一句，不耗额度 */
export async function pingAi(cfg: AiConfig): Promise<{ ok: boolean; message: string; ms: number }> {
  const t0 = performance.now();
  const r = await requestChat(
    cfg,
    [{ role: 'user', content: '只回复两个字：在线' }],
    { maxTokens: 8, timeoutMs: 15000 },
  );
  const ms = Math.round(performance.now() - t0);
  return { ok: r.ok, message: r.ok ? r.text.trim() || '(空响应)' : r.message, ms };
}

/** 纯文本对话 */
export async function chatText(
  cfg: AiConfig,
  system: string,
  user: string,
  opts?: { maxTokens?: number; temperature?: number },
): Promise<{ ok: true; text: string } | AiError> {
  return requestChat(
    cfg,
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    opts,
  );
}

/** 视觉对话（识图）：imageDataUrl 必须是 data:image/...;base64, */
export async function chatVision(
  cfg: AiConfig,
  system: string,
  imageDataUrl: string,
  userText: string,
  opts?: { maxTokens?: number },
): Promise<{ ok: true; text: string } | AiError> {
  return requestChat(
    cfg,
    [
      { role: 'system', content: system },
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: imageDataUrl } },
          { type: 'text', text: userText },
        ],
      },
    ],
    opts,
  );
}

/** 从 AI 回复里尽力抠出 JSON（容忍 markdown 包裹 / 中文引号 / 尾逗号） */
export function extractJson<T>(text: string): T | null {
  if (!text) return null;
  let s = text.trim();
  s = s.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  s = s.replace(/,\s*([}\]])/g, '$1');
  try {
    return JSON.parse(s) as T;
  } catch {
    try {
      return JSON.parse(s.replace(/'/g, '"')) as T;
    } catch {
      return null;
    }
  }
}
