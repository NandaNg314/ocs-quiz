import type { Env } from './index';

export interface StoredModel {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  model: string;
  think_effort: string;
  is_active: number; // 0 or 1
  created_at: string;
  updated_at: string;
}

export interface SafeModel {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyMasked: string;
  model: string;
  thinkEffort: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const CREATE_MODELS_TABLE_SQL = `CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  model TEXT NOT NULL,
  think_effort TEXT DEFAULT '',
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

let modelsSchemaReady = false;

export async function ensureModelsSchema(env: Env): Promise<boolean> {
  if (modelsSchemaReady) return true;
  if (!env.DB) return false;
  try {
    await env.DB.prepare(CREATE_MODELS_TABLE_SQL).run();
    modelsSchemaReady = true;
    return true;
  } catch (err) {
    console.error('D1 models 建表失败', err);
    return false;
  }
}

export function maskApiKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '****';
  return `${key.slice(0, 3)}****${key.slice(-4)}`;
}

export function toSafeModel(row: StoredModel): SafeModel {
  return {
    id: row.id,
    name: row.name,
    baseUrl: row.base_url,
    apiKeyMasked: maskApiKey(row.api_key),
    model: row.model,
    thinkEffort: row.think_effort || '',
    isActive: row.is_active === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export async function listModels(env: Env): Promise<SafeModel[]> {
  if (!env.DB) return [];
  await ensureModelsSchema(env);
  const { results } = await env.DB.prepare('SELECT * FROM models ORDER BY is_active DESC, updated_at DESC').all<StoredModel>();
  return (results || []).map(toSafeModel);
}

export async function getActiveModel(env: Env): Promise<StoredModel | null> {
  if (!env.DB) return null;
  await ensureModelsSchema(env);
  const row = await env.DB.prepare('SELECT * FROM models WHERE is_active = 1 LIMIT 1').first<StoredModel>();
  return row || null;
}

export async function getModelById(env: Env, id: string): Promise<StoredModel | null> {
  if (!env.DB) return null;
  await ensureModelsSchema(env);
  const row = await env.DB.prepare('SELECT * FROM models WHERE id = ?').bind(id).first<StoredModel>();
  return row || null;
}

export interface SaveModelInput {
  id?: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  model: string;
  thinkEffort?: string;
  isActive?: boolean;
}

function cleanBaseUrl(url: string): string {
  let cleaned = url.trim().replace(/\/+$/, '');
  cleaned = cleaned.replace(/\/chat\/completions$/, '').replace(/\/+$/, '');
  return cleaned;
}

export async function saveModel(env: Env, input: SaveModelInput): Promise<SafeModel> {
  if (!env.DB) throw new Error('未配置 D1 数据库 (env.DB)');
  await ensureModelsSchema(env);

  const now = new Date().toISOString();
  let id = input.id?.trim();
  const name = input.name?.trim();
  const baseUrl = cleanBaseUrl(input.baseUrl || '');
  const modelName = input.model?.trim();
  const thinkEffort = (input.thinkEffort || '').trim();

  if (!name) throw new Error('配置名称不能为空');
  if (!baseUrl) throw new Error('Base URL 不能为空');
  if (!modelName) throw new Error('模型名称不能为空');

  if (!id) {
    if (!input.apiKey?.trim()) throw new Error('新增模型时 API Key 不能为空');
    id = crypto.randomUUID();

    const countRes = await env.DB.prepare('SELECT COUNT(*) as count FROM models').first<{ count: number }>();
    const isFirst = (countRes?.count || 0) === 0;
    const shouldActive = input.isActive || isFirst;

    if (shouldActive) {
      await env.DB.prepare('UPDATE models SET is_active = 0').run();
    }

    await env.DB.prepare(
      `INSERT INTO models (id, name, base_url, api_key, model, think_effort, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(id, name, baseUrl, input.apiKey.trim(), modelName, thinkEffort, shouldActive ? 1 : 0, now, now)
      .run();
  } else {
    const existing = await getModelById(env, id);
    if (!existing) throw new Error('模型配置不存在');

    const apiKey = input.apiKey?.trim() ? input.apiKey.trim() : existing.api_key;
    const shouldActive = typeof input.isActive === 'boolean' ? input.isActive : existing.is_active === 1;

    if (shouldActive) {
      await env.DB.prepare('UPDATE models SET is_active = 0').run();
    }

    await env.DB.prepare(
      `UPDATE models SET name = ?, base_url = ?, api_key = ?, model = ?, think_effort = ?, is_active = ?, updated_at = ?
       WHERE id = ?`
    )
      .bind(name, baseUrl, apiKey, modelName, thinkEffort, shouldActive ? 1 : 0, now, id)
      .run();
  }

  const updated = await getModelById(env, id);
  return toSafeModel(updated!);
}

export async function setActiveModel(env: Env, id: string): Promise<boolean> {
  if (!env.DB) return false;
  await ensureModelsSchema(env);
  const target = await getModelById(env, id);
  if (!target) return false;

  await env.DB.batch([
    env.DB.prepare('UPDATE models SET is_active = 0'),
    env.DB.prepare('UPDATE models SET is_active = 1, updated_at = ? WHERE id = ?').bind(new Date().toISOString(), id)
  ]);
  return true;
}

export async function deleteModel(env: Env, id: string): Promise<boolean> {
  if (!env.DB) return false;
  await ensureModelsSchema(env);
  const target = await getModelById(env, id);
  if (!target) return false;

  await env.DB.prepare('DELETE FROM models WHERE id = ?').bind(id).run();

  if (target.is_active === 1) {
    const next = await env.DB.prepare('SELECT id FROM models ORDER BY updated_at DESC LIMIT 1').first<{ id: string }>();
    if (next?.id) {
      await env.DB.prepare('UPDATE models SET is_active = 1 WHERE id = ?').bind(next.id).run();
    }
  }
  return true;
}

export async function testConnection(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
}): Promise<{ ok: boolean; msg: string; latencyMs: number }> {
  const start = Date.now();
  const cleanedUrl = cleanBaseUrl(params.baseUrl);
  const url = `${cleanedUrl}/chat/completions`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${params.apiKey}`
      },
      body: JSON.stringify({
        model: params.model,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5
      }),
      signal: controller.signal
    });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      const errText = await res.text();
      let errMsg = `HTTP ${res.status}`;
      try {
        const json = JSON.parse(errText);
        if (json.error?.message) errMsg += `: ${json.error.message}`;
      } catch {
        errMsg += `: ${errText.slice(0, 100)}`;
      }
      return { ok: false, msg: errMsg, latencyMs };
    }

    return { ok: true, msg: '连接成功', latencyMs };
  } catch (err: unknown) {
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, msg: `请求失败: ${msg}`, latencyMs };
  }
}
