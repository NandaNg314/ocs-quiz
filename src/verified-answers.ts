export interface VerifiedAnswer {
  answers: string[];
  reason: string;
}

interface VerifiedAnswerRow {
  answers: string;
  reason: string;
}

interface VerifiedAnswerEnv {
  DB?: D1Database;
}

const CREATE_TABLE_SQL = `CREATE TABLE IF NOT EXISTS verified_answers (
  question_key TEXT PRIMARY KEY,
  question_type TEXT NOT NULL,
  title TEXT NOT NULL,
  options TEXT NOT NULL,
  answers TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
)`;

let schemaReady = false;

async function ensureSchema(env: VerifiedAnswerEnv): Promise<boolean> {
  if (!env.DB) return false;
  if (schemaReady) return true;
  try {
    await env.DB.prepare(CREATE_TABLE_SQL).run();
    schemaReady = true;
    return true;
  } catch (err) {
    console.error('D1 标准答案表初始化失败', err);
    return false;
  }
}

export async function getVerifiedAnswer(
  env: VerifiedAnswerEnv,
  type: string,
  title: string,
  options: string
): Promise<VerifiedAnswer | null> {
  if (!(await ensureSchema(env))) return null;
  try {
    const row = await env.DB!.prepare('SELECT answers, reason FROM verified_answers WHERE question_key = ?')
      .bind(await questionKey(type, title, options))
      .first<VerifiedAnswerRow>();
    if (!row) return null;
    const answers = JSON.parse(row.answers) as unknown;
    if (!Array.isArray(answers) || !answers.every((answer) => typeof answer === 'string')) return null;
    return { answers, reason: row.reason };
  } catch (err) {
    console.error('D1 标准答案读取失败', err);
    return null;
  }
}

export async function saveVerifiedAnswer(
  env: VerifiedAnswerEnv,
  type: string,
  title: string,
  options: string,
  answers: string[],
  reason: string
): Promise<boolean> {
  if (!(await ensureSchema(env))) return false;
  try {
    await env.DB!.prepare(
      `INSERT INTO verified_answers (question_key, question_type, title, options, answers, reason, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(question_key) DO UPDATE SET
         question_type = excluded.question_type,
         title = excluded.title,
         options = excluded.options,
         answers = excluded.answers,
         reason = excluded.reason,
         updated_at = excluded.updated_at`
    )
      .bind(await questionKey(type, title, options), type, title, options, JSON.stringify(answers), reason, Date.now())
      .run();
    return true;
  } catch (err) {
    console.error('D1 标准答案保存失败', err);
    return false;
  }
}

export async function deleteVerifiedAnswer(
  env: VerifiedAnswerEnv,
  type: string,
  title: string,
  options: string
): Promise<boolean> {
  if (!(await ensureSchema(env))) return false;
  try {
    await env.DB!.prepare('DELETE FROM verified_answers WHERE question_key = ?')
      .bind(await questionKey(type, title, options))
      .run();
    return true;
  } catch (err) {
    console.error('D1 标准答案删除失败', err);
    return false;
  }
}

async function questionKey(type: string, title: string, options: string): Promise<string> {
  const source = JSON.stringify([type.trim(), title.trim(), options.trim()]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
