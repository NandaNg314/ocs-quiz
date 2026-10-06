import { authorize, clientIp, handleOptions, json } from './http';
import { extractImageUrls } from './images';
import { buildSystemPrompt, buildUserContent, callLlm, llmTimeoutMs, type ChatMessage, type LlmConfig } from './llm';
import { logSearch, queryLogs, type SearchLog } from './log';
import {
  deleteModel,
  getActiveModel,
  getModelById,
  listModels,
  saveModel,
  setActiveModel,
  testConnection
} from './models';
import { buildOcsConfig, TOKEN_PLACEHOLDER } from './ocs-config';
import { lettersToOptionTexts, parseLlmAnswer } from './parse';

export interface Env {
  LLM_TEMPERATURE?: string;
  LLM_TIMEOUT_MS?: string;
  VISION_ENABLED?: string;
  LOG_ENABLED?: string;
  /** 搜题请求 (/api/search) 与 /ocs-config.json 的鉴权 token */
  AUTH_TOKEN?: string;
  /** 日志页与模型管理 (/api/logs, /api/models) 的鉴权 token, 与 AUTH_TOKEN 相互独立 */
  WEBUI_TOKEN?: string;
  DB?: D1Database;
  /** Workers Static Assets 绑定 (React 前端) */
  ASSETS?: Fetcher;
}

interface SearchBody {
  title?: unknown;
  options?: unknown;
  type?: unknown;
  /** 请求方携带的 LLM 配置 (BYOK, 可选); 不传时自动使用服务端激活的模型; apiKey 不会写入日志 */
  apiKey?: unknown;
  baseUrl?: unknown;
  model?: unknown;
  /** 可选的思考强度, 透传为 reasoning_effort; 不填使用模型默认强度 */
  thinkEffort?: unknown;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') return handleOptions();
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/api/health') {
      return json({ ok: true });
    }
    if (path === '/ocs-config.json') {
      // token 缺失或错误时返回占位符而非 401, 避免该公开接口被用来探测 token
      const token = env.AUTH_TOKEN && !authorize(request, env.AUTH_TOKEN, url) ? TOKEN_PLACEHOLDER : env.AUTH_TOKEN;
      return json(
        buildOcsConfig(url.origin, {
          token,
          apiKey: url.searchParams.get('apiKey') || undefined,
          baseUrl: url.searchParams.get('baseUrl') || undefined,
          model: url.searchParams.get('model') || undefined,
          thinkEffort: url.searchParams.get('thinkEffort') || undefined
        })
      );
    }
    if (path === '/api/search' && request.method === 'POST') {
      return handleSearch(request, env);
    }
    if (path === '/api/logs' && request.method === 'GET') {
      if (!env.WEBUI_TOKEN) {
        return json({ code: 1, msg: '服务端未配置 WEBUI_TOKEN, 请执行 wrangler secret put WEBUI_TOKEN' }, 403);
      }
      if (!authorize(request, env.WEBUI_TOKEN)) return json({ code: 1, msg: '未授权' }, 401);
      const limit = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1), 200);
      return json({ code: 0, data: await queryLogs(env, limit), timeoutMs: llmTimeoutMs(env) });
    }

    // 模型管理 API
    if (path === '/api/models' && request.method === 'GET') {
      if (!env.WEBUI_TOKEN) {
        return json({ code: 1, msg: '服务端未配置 WEBUI_TOKEN, 请执行 wrangler secret put WEBUI_TOKEN' }, 403);
      }
      if (!authorize(request, env.WEBUI_TOKEN)) return json({ code: 1, msg: '未授权' }, 401);
      return json({ code: 0, data: await listModels(env) });
    }
    if (path === '/api/models' && request.method === 'POST') {
      if (!env.WEBUI_TOKEN) {
        return json({ code: 1, msg: '服务端未配置 WEBUI_TOKEN, 请执行 wrangler secret put WEBUI_TOKEN' }, 403);
      }
      if (!authorize(request, env.WEBUI_TOKEN)) return json({ code: 1, msg: '未授权' }, 401);
      try {
        const body = (await request.json()) as any;
        const saved = await saveModel(env, body);
        return json({ code: 0, data: saved });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return json({ code: 1, msg }, 400);
      }
    }
    if (path === '/api/models/test' && request.method === 'POST') {
      if (!env.WEBUI_TOKEN) {
        return json({ code: 1, msg: '服务端未配置 WEBUI_TOKEN, 请执行 wrangler secret put WEBUI_TOKEN' }, 403);
      }
      if (!authorize(request, env.WEBUI_TOKEN)) return json({ code: 1, msg: '未授权' }, 401);
      try {
        const body = (await request.json()) as any;
        let { baseUrl, apiKey, model, id } = body;
        if (id && (!apiKey || apiKey.includes('****'))) {
          const existing = await getModelById(env, id);
          if (existing) {
            apiKey = existing.api_key;
            if (!baseUrl) baseUrl = existing.base_url;
            if (!model) model = existing.model;
          }
        }
        if (!baseUrl || !apiKey || !model) {
          return json({ code: 1, msg: '缺少必要的测试参数 (baseUrl, apiKey, model)' }, 400);
        }
        const result = await testConnection({ baseUrl, apiKey, model });
        return json({ code: 0, data: result });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return json({ code: 1, msg }, 400);
      }
    }
    if (
      path.startsWith('/api/models/') &&
      path.endsWith('/active') &&
      (request.method === 'POST' || request.method === 'PUT')
    ) {
      if (!env.WEBUI_TOKEN) {
        return json({ code: 1, msg: '服务端未配置 WEBUI_TOKEN, 请执行 wrangler secret put WEBUI_TOKEN' }, 403);
      }
      if (!authorize(request, env.WEBUI_TOKEN)) return json({ code: 1, msg: '未授权' }, 401);
      const parts = path.split('/');
      const id = decodeURIComponent(parts[3] || '');
      const ok = await setActiveModel(env, id);
      return json({ code: ok ? 0 : 1, msg: ok ? '已切换激活模型' : '模型不存在' });
    }
    if (path.startsWith('/api/models/') && request.method === 'DELETE') {
      if (!env.WEBUI_TOKEN) {
        return json({ code: 1, msg: '服务端未配置 WEBUI_TOKEN, 请执行 wrangler secret put WEBUI_TOKEN' }, 403);
      }
      if (!authorize(request, env.WEBUI_TOKEN)) return json({ code: 1, msg: '未授权' }, 401);
      const id = decodeURIComponent(path.slice('/api/models/'.length));
      const ok = await deleteModel(env, id);
      return json({ code: ok ? 0 : 1, msg: ok ? '已删除' : '模型不存在' });
    }

    if (path === '/logs') {
      return Response.redirect(new URL('/', url).toString(), 302);
    }
    // 其余路径交给静态资源 (React 前端), 未命中则 404
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return json({ code: 1, msg: 'Not Found' }, 404);
  }
};

/**
 * OCS 只把 HTTP 200 视为成功, 其余状态码一律显示「题库连接失败」且不展示 msg。
 * 因此仅鉴权失败(401)与非 JSON 请求体(400)使用错误状态码;
 * 题目为空、LLM 失败、无法作答等业务错误返回 200 + code:1, 由 handler 把 msg 显示在 OCS 面板。
 */
async function handleSearch(request: Request, env: Env): Promise<Response> {
  const ip = clientIp(request);
  const log = (entry: Omit<SearchLog, 'ip'>) => logSearch(env, { ...entry, ip });

  if (!authorize(request, env.AUTH_TOKEN)) {
    await log({
      questionType: 'unknown',
      title: '',
      options: '',
      images: 0,
      model: '',
      answers: '',
      reason: '',
      latencyMs: 0,
      status: 'unauthorized',
      error: '未授权: 缺少或错误的 Bearer token',
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      thinkEffort: ''
    });
    return json({ code: 1, msg: '未授权' }, 401);
  }

  let body: SearchBody;
  try {
    body = (await request.json()) as SearchBody;
  } catch {
    await log({
      questionType: 'unknown',
      title: '',
      options: '',
      images: 0,
      model: '',
      answers: '',
      reason: '',
      latencyMs: 0,
      status: 'error',
      error: '请求体必须是 JSON',
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      thinkEffort: ''
    });
    return json({ code: 1, msg: '请求体必须是 JSON' }, 400);
  }

  const title = typeof body.title === 'string' ? body.title.slice(0, 3000) : '';
  const options = typeof body.options === 'string' ? body.options.slice(0, 6000) : '';
  const type = typeof body.type === 'string' && body.type ? body.type : 'unknown';
  const thinkEffort = typeof body.thinkEffort === 'string' ? body.thinkEffort.trim() : '';
  if (!title.trim() && !options.trim()) {
    await log({
      questionType: type,
      title,
      options,
      images: 0,
      model: '',
      answers: '',
      reason: '',
      latencyMs: 0,
      status: 'error',
      error: '题目为空',
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      thinkEffort
    });
    return json({ code: 1, msg: '题目为空' });
  }

  const images = extractImageUrls(title, options);
  const visionEnabled = env.VISION_ENABLED !== 'false';
  const rawApiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const rawBaseUrl = typeof body.baseUrl === 'string' ? body.baseUrl.trim() : '';
  const rawModel = typeof body.model === 'string' ? body.model.trim() : '';

  let llmConfig: Partial<LlmConfig> = {
    apiKey: rawApiKey || undefined,
    baseUrl: rawBaseUrl || undefined,
    model: rawModel || undefined,
    thinkEffort: thinkEffort || undefined
  };

  // 若请求未完整提供模型三要素，从 D1 提取当前激活的模型 (服务端热管理模式)
  if (!llmConfig.apiKey || !llmConfig.baseUrl || !llmConfig.model) {
    const active = await getActiveModel(env);
    if (active) {
      llmConfig = {
        apiKey: llmConfig.apiKey || active.api_key,
        baseUrl: llmConfig.baseUrl || active.base_url,
        model: llmConfig.model || active.model,
        thinkEffort: llmConfig.thinkEffort || active.think_effort || undefined
      };
    }
  }

  if (!llmConfig.apiKey || !llmConfig.baseUrl || !llmConfig.model) {
    const errText = '未配置可用模型: 请在管理后台添加并激活模型，或在 OCS 插件中配置 apiKey/baseUrl/model';
    await log({
      questionType: type,
      title,
      options,
      images: images.length,
      model: '',
      answers: '',
      reason: '',
      latencyMs: 0,
      status: 'error',
      error: errText,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      thinkEffort
    });
    return json({ code: 1, msg: errText });
  }
  const messages: ChatMessage[] = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildUserContent(title, options, type, images, visionEnabled) }
  ];

  try {
    const { content, model, latencyMs, usage } = await callLlm(env, messages, llmConfig);
    const parsed = parseLlmAnswer(content, type);
    const reason = parsed.reason;
    // 选择/判断题的字母答案换成选项原文, OCS 才能稳定匹配 (见 lettersToOptionTexts)
    const answers = type === 'completion' ? parsed.answers : lettersToOptionTexts(parsed.answers, options, type);
    const status = answers.length > 0 ? 'ok' : 'no_answer';
    await log({
      questionType: type,
      title,
      options,
      images: images.length,
      model,
      answers: JSON.stringify({ answers, reason }),
      reason,
      latencyMs,
      status,
      error: '',
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      cachedTokens: usage.cachedTokens,
      thinkEffort: (llmConfig.thinkEffort || thinkEffort) as string
    });
    if (status === 'no_answer') {
      return json({ code: 1, msg: `无法作答: ${reason || '模型未给出答案'}` });
    }
    return json({
      code: 0,
      data: {
        question: title,
        answers,
        reason,
        model,
        latency_ms: latencyMs,
        usage: {
          prompt_tokens: usage.promptTokens,
          completion_tokens: usage.completionTokens,
          cached_tokens: usage.cachedTokens
        }
      }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await log({
      questionType: type,
      title,
      options,
      images: images.length,
      model: llmConfig.model || '',
      answers: '',
      reason: '',
      latencyMs: 0,
      status: 'error',
      error: message,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      thinkEffort
    });
    return json({ code: 1, msg: `答题失败: ${message.slice(0, 300)}` });
  }
}