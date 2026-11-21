import { Capacitor, registerPlugin } from '@capacitor/core';

export type SecretKind = 'ai' | 'ocr';
type Action = 'get' | 'set' | 'delete';
type Bridge = { access(action: Action, id: string, value?: string): Promise<string> };
const native = registerPlugin<{ access(options: { action: Action; id: string; value?: string }): Promise<{ value?: string }> }>('Secrets');

/** 密钥绑定用途及完整规范化接口地址，不自动跨用途或服务商复用。 */
async function secretId(kind: SecretKind, baseUrl: string): Promise<string> {
  const url = new URL(baseUrl.trim());
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('密钥接口地址必须是无凭据的 HTTPS 地址');
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/chat\/completions$/, '').replace(/\/+$/, '');
  const canonical = url.origin + (url.pathname || '/');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
  return `${kind}:${Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('')}`;
}
async function access(action: Action, id: string, value?: string): Promise<string> {
  const desktop = (window as Window & { coilbook?: { secrets?: Bridge } }).coilbook?.secrets;
  if (desktop) return desktop.access(action, id, value);
  if (Capacitor.getPlatform() === 'android') return (await native.access({ action, id, value })).value ?? '';
  throw new Error('当前平台没有可用的系统安全密钥存储，已禁止明文保存');
}
export async function getSecret(kind: SecretKind, baseUrl: string): Promise<string> {
  return access('get', await secretId(kind, baseUrl));
}
export async function setSecret(kind: SecretKind, baseUrl: string, value: string): Promise<void> {
  await access(value ? 'set' : 'delete', await secretId(kind, baseUrl), value);
}
/** 旧明文只在成功写入安全存储后清除；失败时明确报错，不作网络请求。 */
export async function migrateLegacySecrets(): Promise<void> {
  const raw = localStorage.getItem('cbc.settings.v1');
  if (!raw) return;
  const settings = JSON.parse(raw);
  if (settings?.ai?.apiKey) await setSecret('ai', settings.ai.baseUrl, settings.ai.apiKey);
  if (settings?.ocr?.cloudApiKey) await setSecret('ocr', settings.ocr.cloudBaseUrl, settings.ocr.cloudApiKey);
  if (settings?.ai) settings.ai.apiKey = '';
  if (settings?.ocr) settings.ocr.cloudApiKey = '';
  localStorage.setItem('cbc.settings.v1', JSON.stringify(settings));
}

/** 更新源凭据与具体仓库无关，用固定 scope 生成 id（仅用于 GitHub 更新检查） */
async function scopedId(prefix: string, scope: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(scope));
  return `${prefix}:${Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export async function getUpdateToken(): Promise<string> {
  return access('get', await scopedId('update', 'github.com'));
}

export async function setUpdateToken(value: string): Promise<void> {
  await access(value ? 'set' : 'delete', await scopedId('update', 'github.com'), value);
}