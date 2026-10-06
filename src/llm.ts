import type { Env } from './index';

export interface ChatMessage {
  role: 'system' | 'user';
  content: string | ContentPart[];
}

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

/**
 * 单次 LLM 请求的默认超时 (可用 LLM_TIMEOUT_MS 覆盖)。
 * Workers 对 HTTP 请求没有墙钟时长上限, 等待 fetch 也不计入 CPU 时间;
 * 实际约束是 OCS 的「搜题最大耗时」(高级设置, 默认 120s, 范围 10-180s; 4.11.8 之前固定 30s)。
 * 取略低于 120s 的 110s: 超时由 Worker 先返回 msg, OCS 面板才能显示原因, 而不是「题库连接失败」。
 * 超时属于网络错误, 不会触发降级重试。
 */
const DEFAULT_TIMEOUT_MS = 110000;

export function llmTimeoutMs(env: Env): number {
  return parseInt(env.LLM_TIMEOUT_MS || '', 10) || DEFAULT_TIMEOUT_MS;
}

export function buildSystemPrompt(): string {
  return [
    '你是在线课程专业答题助手。根据题目、选项与图片，给出绝对准确的答案。',
    '必须严格只输出一个合法 JSON 对象，禁止输出任何其他文字、说明或 markdown 代码块。',
    '必须按以下顺序输出（先在 reason 字段中进行简要分析推导，再在 answers 中给出答案）：',
    '{"reason": "简要分析考点与各选项对错", "answers": ["答案1", "答案2"]}',
    '',
    '【答案规则与题型特别要求】:',
    '1. 单选(single): answers 数组只含 1 个元素，输出对应选项的大写字母，如 ["A"]。',
    '2. 多选(multiple): 【极重要】多选题必须选择 2 个或 2 个以上正确选项（严禁只返回 1 个选项！多选题绝对不可单选）。请逐一甄别所有选项，找出全部符合题意的选项，按字母升序输出，如 ["A", "C"] 或 ["A", "B", "D"]。',
    '3. 判断(judgement): answers 数组只含 1 个元素。请特别注意：部分平台 A 选项是“错”而 B 选项是“对”，务必看清选项字母对应的具体含义再选择对应字母（如选项为 A.错 B.对 且陈述正确时，应输出 ["B"]）。若选项无字母，则输出 ["对"] 或 ["错"]。',
    '4. 填空(completion): answers 数组每个元素对应一个空，按题目顺序排列，严禁在答案内部拼入任何分隔符。',
    '5. 未知类型(unknown): 请根据题干提问方式（如含有“哪些/包括/属于...的有”通常为多选题，必须选2项以上；陈述句带括号通常为单选题；只有两项且为对错时为判断题）精准判定并按对应规则输出。',
    '6. 信息严重不足无法作答时，输出 {"reason": "原因", "answers": []}。',
    '7. 含图片的题目必须结合图片中的文字、图示细节作答。'
  ].join('\n');
}

export function buildUserContent(
  title: string,
  options: string,
  type: string,
  images: string[],
  visionEnabled: boolean
): string | ContentPart[] {
  const typeHint =
    type === 'multiple'
      ? 'multiple (【多选题特别提示】：本题为多选题，必须选出 2 个或 2 个以上正确选项，严禁只选 1 个)'
      : type === 'judgement'
        ? 'judgement (【判断题提示】：请特别核对各选项字母代表的具体含义)'
        : type || 'unknown';

  const text = [
    `题目类型: ${typeHint}`,
    title ? `题目: ${title}` : '',
    options ? `选项:\n${options}` : '',
    images.length ? `题目/选项中包含以下图片:\n${images.map((u) => `- ${u}`).join('\n')}` : ''
  ]
    .filter(Boolean)
    .join('\n');

  if (!visionEnabled || images.length === 0) return text;
  return [{ type: 'text', text }, ...images.map((url) => ({ type: 'image_url' as const, image_url: { url } }))];
}

export interface LlmResult {
  content: string;
  model: string;
  latencyMs: number;
  attempts: number;
  usage: LlmUsage;
}

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  cachedTokens: number;
}

interface Strategy {
  json: boolean;
  vision: boolean;
}

/** 调用方随请求携带的 LLM 配置 (BYOK), 服务端不提供兜底值 */
export interface LlmConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /**
   * 可选的思考强度, 原样透传为 reasoning_effort (如 DeepSeek: none/low/high/max,
   * OpenAI: minimal/low/medium/high); 不填则不发送, 使用服务商默认强度
   */
  thinkEffort?: string;
}

const REQUIRED_FIELDS = ['apiKey', 'baseUrl', 'model'] as const;

/** 校验 BYOK 配置: 三项均必填, 缺失时一次列出全部缺失字段 */
export function resolveLlmConfig(input: Partial<LlmConfig>): LlmConfig {
  const missing = REQUIRED_FIELDS.filter((k) => !input[k]);
  if (missing.length) {
    throw new Error(`缺少 ${missing.join(', ')}: 请在请求中携带这些字段`);
  }
  const { apiKey, baseUrl, model, thinkEffort } = input as LlmConfig;
  return { apiKey, baseUrl: baseUrl.replace(/\/+$/, ''), model, thinkEffort };
}

/**
 * 调用 OpenAI 兼容 chat/completions。
 *
 * 兼容性降级(遇 400/422/404 自动推进):
 * - 含图片: 1. json 约束 + 图片  -> 2. 无 json 约束 + 图片  -> 3. json 约束 + 无图  -> 4. 均不带
 * - 无图片: 1. json 约束  -> 2. 无 json 约束
 * 覆盖: 不支持 response_format 的 API、不支持视觉输入的模型。
 * 认证错误(401/403)与网络/超时错误直接抛出, 不做无谓重试。
 */
export async function callLlm(env: Env, messages: ChatMessage[], config: Partial<LlmConfig>): Promise<LlmResult> {
  const resolved = resolveLlmConfig(config);
  const temperature = parseFloat(env.LLM_TEMPERATURE || '0') || 0;
  const timeoutMs = llmTimeoutMs(env);

  const hasImages = messages.some(
    (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url')
  );
  const textOnly: Strategy[] = [
    { json: true, vision: false },
    { json: false, vision: false }
  ];
  const strategies: Strategy[] = hasImages
    ? [{ json: true, vision: true }, { json: false, vision: true }, ...textOnly]
    : textOnly;

  const started = Date.now();
  let attempts = 0;
  let lastError: Error | null = null;
  for (const strategy of strategies) {
    try {
      attempts++;
      const { content, usage } = await requestCompletion(resolved, temperature, messages, strategy, timeoutMs);
      return { content, model: resolved.model, latencyMs: Date.now() - started, attempts, usage };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      const status = (err as { status?: number }).status;
      // 认证失败或网络/超时: 重试无意义
      if (status === 401 || status === 403 || status === undefined) throw lastError;
    }
  }
  throw lastError ?? new Error('LLM 调用失败');
}

async function requestCompletion(
  { baseUrl, model, apiKey, thinkEffort }: LlmConfig,
  temperature: number,
  messages: ChatMessage[],
  strategy: Strategy,
  timeoutMs: number
): Promise<{ content: string; usage: LlmUsage }> {
  const body: Record<string, unknown> = {
    model,
    temperature,
    messages: messages.map((m) => ({
      ...m,
      content:
        typeof m.content === 'string' || strategy.vision
          ? m.content
          : m.content.filter((p) => p.type !== 'image_url').map((p) => (p.type === 'text' ? p.text : '')).join('\n')
    }))
  };
  if (strategy.json) body.response_format = { type: 'json_object' };
  if (thinkEffort) body.reasoning_effort = thinkEffort;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const err = new Error(`LLM API ${res.status}: ${detail.slice(0, 300)}`);
    (err as { status?: number }).status = res.status;
    throw err;
  }
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: unknown } }>;
    usage?: {
      prompt_tokens?: unknown;
      completion_tokens?: unknown;
      completion_tokens_details?: { reasoning_tokens?: unknown };
      prompt_tokens_details?: { cached_tokens?: unknown };
      prompt_cache_hit_tokens?: unknown;
    };
  };
  const rawMsg = data.choices?.[0]?.message as { content?: unknown; reasoning_content?: unknown } | undefined;
  const content =
    typeof rawMsg?.content === 'string' && rawMsg.content.trim()
      ? rawMsg.content
      : typeof rawMsg?.reasoning_content === 'string'
        ? rawMsg.reasoning_content
        : '';
  if (!content.trim()) {
    throw new Error('LLM 返回内容为空');
  }
  const baseCompletionTokens = Number(data.usage?.completion_tokens) || 0;
  const reasoningTokens = Number(data.usage?.completion_tokens_details?.reasoning_tokens) || 0;
  return {
    content,
    usage: {
      promptTokens: Number(data.usage?.prompt_tokens) || 0,
      completionTokens: baseCompletionTokens + reasoningTokens,
      // OpenAI 兼容: prompt_tokens_details.cached_tokens; DeepSeek: prompt_cache_hit_tokens
      cachedTokens:
        Number(data.usage?.prompt_tokens_details?.cached_tokens) ||
        Number(data.usage?.prompt_cache_hit_tokens) ||
        0
    }
  };
}