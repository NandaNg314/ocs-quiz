export interface ParsedAnswer {
  answers: string[];
  reason: string;
}

export interface ParsedOptionItem {
  letter: string;
  text: string;
  raw: string;
}

/**
 * 智能解析题目 options 字符串，兼容多种换行与标号格式：
 * 1. 独立字母行模式（常见于超星 DOM 分割提取）：
 *    A.
 *    《尤丽迪茜》
 *    B.
 *    《阿尔切斯特》
 * 2. 紧凑行模式（带标号）：
 *    A. 舞剧 或 (A) 舞剧 或 A、舞剧
 * 3. 紧凑行模式（不带标号纯文本）：
 *    舞剧
 *    歌剧
 */
export function parseOptionsList(options: string): ParsedOptionItem[] {
  if (!options || typeof options !== 'string') return [];
  const rawLines = options
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (rawLines.length === 0) return [];

  const isPureLetterMarker = (s: string) => /^(?:\(?[A-Za-z]\)?|[A-Za-z][.、:：\s)]*)$/.test(s.trim());
  const extractLetter = (s: string) => {
    const m = s.match(/[A-Za-z]/);
    return m ? m[0].toUpperCase() : '';
  };

  // 1. 检查是否存在独立字母行模式
  let hasStandaloneLetters = false;
  for (let i = 0; i < rawLines.length - 1; i++) {
    if (isPureLetterMarker(rawLines[i]) && !isPureLetterMarker(rawLines[i + 1])) {
      hasStandaloneLetters = true;
      break;
    }
  }

  const items: ParsedOptionItem[] = [];

  if (hasStandaloneLetters) {
    let currentLetter = '';
    let currentText = '';

    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (isPureLetterMarker(line)) {
        if (currentLetter || currentText) {
          items.push({
            letter: currentLetter,
            text: currentText.trim(),
            raw: currentText.trim()
          });
        }
        currentLetter = extractLetter(line);
        currentText = '';
      } else {
        if (currentText) {
          currentText += ' ' + line;
        } else {
          currentText = line;
        }
      }
    }
    if (currentLetter || currentText) {
      items.push({
        letter: currentLetter,
        text: currentText.trim(),
        raw: currentText.trim()
      });
    }
  } else {
    // 2. 紧凑行模式
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      const match = line.match(/^(?:\(?([A-Za-z])\)?|[A-Za-z])[.、:：\s]+\s*(.*)$/);
      if (match) {
        const letter = (match[1] || match[0].match(/[A-Za-z]/)?.[0] || String.fromCharCode(65 + i)).toUpperCase();
        const text = (match[2] || '').trim();
        items.push({
          letter,
          text: text || line,
          raw: line
        });
      } else {
        const autoLetter = String.fromCharCode(65 + i);
        items.push({
          letter: autoLetter,
          text: line,
          raw: line
        });
      }
    }
  }

  return items;
}

/**
 * 标准化题目类型，兼容超星学习通、智慧树等各大平台的多种入参格式：
 * 1. 英文格式: single, multiple, judgement, completion
 * 2. 数字格式: 1 (单选), 2 (多选), 3 (判断), 4 (填空)
 * 3. 中文格式: 单选, 多选, 判断, 填空, 单选题, 多选题, 判断题, 填空题
 * 4. 题干标注推断: 如题干含 【多选题】或 [判断题] 时自动推断
 * 5. 选项特征推断: 仅两项且表述对错时推断为判断题
 */
export function normalizeQuestionType(rawType: unknown, title: string = '', options: string = ''): string {
  const s = String(rawType ?? '').trim().toLowerCase();

  // 1. 显式类型匹配
  if (s === 'single' || s.includes('single') || s === '0' || s === '1' || s.includes('单选')) {
    return 'single';
  }
  if (s === 'multiple' || s.includes('multi') || s === '2' || s.includes('多选')) {
    return 'multiple';
  }
  if (s === 'judgement' || s === 'judgment' || s.includes('judge') || s === '3' || s.includes('判断')) {
    return 'judgement';
  }
  if (s === 'completion' || s.includes('complete') || s === '4' || s.includes('填空')) {
    return 'completion';
  }

  // 2. 从题干标题推断
  const cleanTitle = title.trim();
  if (/(?:\[|【|\(|（)\s*多选(?:题)?\s*(?:\]|】|\)|）)/.test(cleanTitle) || /(?:^|\s)多选题/.test(cleanTitle)) {
    return 'multiple';
  }
  if (/(?:\[|【|\(|（)\s*单选(?:题)?\s*(?:\]|】|\)|）)/.test(cleanTitle) || /(?:^|\s)单选题/.test(cleanTitle)) {
    return 'single';
  }
  if (/(?:\[|【|\(|（)\s*判断(?:题)?\s*(?:\]|】|\)|）)/.test(cleanTitle) || /(?:^|\s)判断题/.test(cleanTitle)) {
    return 'judgement';
  }
  if (/(?:\[|【|\(|（)\s*填空(?:题)?\s*(?:\]|】|\)|）)/.test(cleanTitle) || /(?:^|\s)填空题/.test(cleanTitle)) {
    return 'completion';
  }

  // 3. 从选项特征推断
  if (options) {
    const lines = options.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length === 2 && lines.every((l) => /(对|错|正确|错误|是|否|√|×|true|false)/i.test(l))) {
      return 'judgement';
    }
  }

  return s || 'unknown';
}

/**
 * 解析 LLM 输出为答案数组。
 *
 * LLM 被要求输出 JSON: {"reason": "...", "answers": [...]}
 * 此处做宽松解析: 去掉代码围栏、截取 JSON 对象、兼容 reason/analysis/explanation 与 answers/answer/result。
 * JSON 解析失败时退化为纯文本按类型拆分。
 */
export function parseLlmAnswer(raw: string, type: string): ParsedAnswer {
  const text = stripFences(raw.trim());
  const obj = tryExtractJson(text);
  if (obj) {
    const rawAnswers = obj.answers ?? obj.answer ?? obj.result;
    const reason =
      typeof obj.reason === 'string'
        ? obj.reason.slice(0, 500)
        : typeof obj.analysis === 'string'
          ? obj.analysis.slice(0, 500)
          : typeof obj.explanation === 'string'
            ? obj.explanation.slice(0, 500)
            : '';

    let answers: string[] = [];
    if (Array.isArray(rawAnswers)) {
      for (const item of rawAnswers) {
        const str = String(item ?? '').trim();
        if (!str) continue;
        // 如果数组元素内包含诸如 "A, B" 或 "AB" 或 "A、B"，针对选择/判断题拆分成独立的字母
        if (type !== 'completion') {
          const split = splitStringAnswers(str, type);
          if (split.length > 1) {
            answers.push(...split);
            continue;
          }
        }
        answers.push(str);
      }
    } else {
      answers = splitStringAnswers(typeof rawAnswers === 'string' ? rawAnswers : String(rawAnswers ?? ''), type);
    }

    // 多选题兜底：若模型只给了 1 个选项，尝试从推导理由 (reason) 中检索补充遗漏的正确选项
    if (type === 'multiple' && answers.length === 1 && reason) {
      const ansMatch = reason.match(/(?:正确答案(?:为|是)|符合题意(?:的)?(?:为|是)|正确选项(?:为|是)|故选|应选|因此选)\s*([A-Za-z\s,，、和与及]+)/i);
      if (ansMatch) {
        const extracted = splitStringAnswers(ansMatch[1], 'multiple');
        if (extracted.length >= 2) {
          answers = extracted;
        }
      }
    }

    // 多选题按字母升序排序
    if (type === 'multiple' && answers.every((a) => /^[A-Za-z]$/.test(a.trim()))) {
      answers.sort((a, b) => a.trim().toUpperCase().localeCompare(b.trim().toUpperCase()));
    }

    return {
      answers: dedupe(answers),
      reason
    };
  }
  return { answers: dedupe(splitStringAnswers(text, type)), reason: '' };
}

function stripFences(text: string): string {
  return text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
}

function tryExtractJson(text: string): Record<string, unknown> | undefined {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end <= start) return undefined;
  try {
    const obj = JSON.parse(text.slice(start, end + 1));
    return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 纯文本答案拆分:
 * - completion: 只用 `|` 分隔(多个空), 避免拆坏含标点的答案文本
 * - 其他类型: 去掉常见分隔符后若为纯字母, 逐字符拆成选项字母;
 *   否则按常见分隔符拆分
 */
function splitStringAnswers(s: string, type: string): string[] {
  s = s.trim();
  if (!s) return [];
  if (type === 'completion') {
    return s
      .split('|')
      .map((t) => t.trim())
      .filter(Boolean);
  }
  const cleaned = s.replace(/[,，.。、;；#\s和与及]+/g, '');
  if (/^[A-Za-z]+$/.test(cleaned)) {
    return [...cleaned].map((c) => c.toUpperCase());
  }
  return s
    .split(/[,，.。、;；#|\s和与及]+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * 把选项字母或判断词汇换成对应的选项原文，确保 OCS 能够稳定命中页面 DOM 选项。
 *
 * 智能增强：
 * 1. 结构化解析选项列表，解决独立字母行错位问题（彻底修复 D -> lines[3] 取错的致命 Bug）。
 * 2. 判断题智能极性对齐（自动匹配“对/错/正确/错误”到对应的选项行，避免 A/B 倒置）。
 * 3. 兼容选项字母（A/B/C/D）、带前缀文本（A. 舞剧）与纯文本内容。
 */
export function lettersToOptionTexts(answers: string[], options: string, questionType: string = ''): string[] {
  if (!answers || !answers.length || !options) return answers;
  const parsed = parseOptionsList(options);
  if (parsed.length === 0) return answers;

  const letterMap = new Map<string, ParsedOptionItem>();
  for (const opt of parsed) {
    if (opt.letter) {
      letterMap.set(opt.letter.toUpperCase(), opt);
    }
  }

  const result: string[] = [];

  for (const ans of answers) {
    const rawAns = ans.trim();
    if (!rawAns) continue;

    // 1. 判断题语义极性匹配 ("对"/"错"/"正确"/"错误"/"√"/"×")
    if (/^(对|错|正确|错误|是|否|√|×|true|false)$/i.test(rawAns)) {
      const isPositive = /^(对|正确|是|√|true)$/i.test(rawAns);
      let matchedOpt: ParsedOptionItem | null = null;
      for (const opt of parsed) {
        if (isPositive) {
          if (opt.text.includes('对') || opt.text.includes('正确') || opt.text.includes('√') || opt.text.includes('是')) {
            matchedOpt = opt;
            break;
          }
        } else {
          if (opt.text.includes('错') || opt.text.includes('错误') || opt.text.includes('×') || opt.text.includes('否')) {
            matchedOpt = opt;
            break;
          }
        }
      }
      if (matchedOpt) {
        result.push(matchedOpt.raw || matchedOpt.text);
        continue;
      }
    }

    // 2. 单个大写字母 (如 "A", "B", "C", "D")
    const letterMatch = rawAns.match(/^[A-Za-z]$/);
    if (letterMatch) {
      const char = letterMatch[0].toUpperCase();
      const opt = letterMap.get(char);
      if (opt) {
        result.push(opt.raw || opt.text);
        continue;
      }
    }

    // 3. 带有字母前缀的答案 (如 "A. 舞剧" 或 "A 舞剧")
    const prefixMatch = rawAns.match(/^[A-Za-z][.、:：\s]+(.*)$/);
    if (prefixMatch) {
      const char = rawAns[0].toUpperCase();
      const opt = letterMap.get(char);
      if (opt) {
        result.push(opt.raw || opt.text);
        continue;
      }
    }

    // 4. 选项文本精确或模糊匹配 (如模型直接返回 "《达芙妮》" 或 "达芙妮")
    let foundByText: ParsedOptionItem | null = null;
    for (const opt of parsed) {
      if (opt.text === rawAns || opt.raw === rawAns) {
        foundByText = opt;
        break;
      }
      const cleanAns = rawAns.replace(/[《》""''“”‘’\s]/g, '');
      const cleanOpt = opt.text.replace(/[《》""''“”‘’\s]/g, '');
      if (cleanAns && cleanOpt && (cleanAns === cleanOpt || cleanOpt.includes(cleanAns) || cleanAns.includes(cleanOpt))) {
        foundByText = opt;
        break;
      }
    }
    if (foundByText) {
      result.push(foundByText.raw || foundByText.text);
      continue;
    }

    // 5. 兜底原样返回
    result.push(rawAns);
  }

  return dedupe(result);
}

function dedupe(items: string[]): string[] {
  return [...new Set(items)];
}