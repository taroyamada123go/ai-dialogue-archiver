export const APP_VERSION = '0.5.5';

export function normalizeText(input) {
  return String(input ?? '')
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const keys = Object.keys(value).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(value[k])).join(',') + '}';
}

export async function sha256(data) {
  const bytes = data instanceof Uint8Array
    ? data
    : data instanceof ArrayBuffer
      ? new Uint8Array(data)
      : new TextEncoder().encode(String(data));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export function extractMessageText(message) {
  if (!message) return '';
  const content = message.content ?? message;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(partToText).filter(Boolean).join('\n');
  if (Array.isArray(content?.parts)) return content.parts.map(partToText).filter(Boolean).join('\n');
  if (typeof content?.text === 'string') return content.text;
  if (typeof message.text === 'string') return message.text;
  return '';
}

function partToText(part) {
  if (typeof part === 'string') return part;
  if (!part || typeof part !== 'object') return '';
  if (typeof part.text === 'string') return part.text;
  if (typeof part.content === 'string') return part.content;
  if (typeof part.caption === 'string') return part.caption;
  return '';
}

export function roleOf(message) {
  return message?.author?.role ?? message?.role ?? 'unknown';
}

export function fmtTime(value) {
  if (value == null || value === '') return null;
  let ms;
  if (typeof value === 'number') ms = value < 1e12 ? value * 1000 : value;
  else {
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return null;
    ms = parsed;
  }
  const d = new Date(ms);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export function deepWalk(value, visitor, path = []) {
  visitor(value, path);
  if (Array.isArray(value)) value.forEach((v, i) => deepWalk(v, visitor, path.concat(i)));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) deepWalk(v, visitor, path.concat(k));
  }
}

export function basename(path) {
  return String(path ?? '').replace(/\\/g, '/').split('/').pop();
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function stableId(prefix = 'id') {
  if (crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  const arr = new Uint8Array(16); crypto.getRandomValues(arr);
  return `${prefix}-${[...arr].map(x => x.toString(16).padStart(2,'0')).join('')}`;
}
