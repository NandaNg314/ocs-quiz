import { useEffect, useMemo, useState } from 'react';
import {
  EFFORT_STEPS,
  LATENCY_LABEL,
  STATUS_LABEL,
  analyzeRow,
  formatLatency,
  latencyLevel,
  plainText,
  timeParts,
  typeLabel,
  type LogRow
} from './format';
import { IconAlert, IconCheck, IconImage } from './icons';
import { RichText, type ZoomTarget } from './rich';

const CALLOUT_TITLE: Record<string, string> = {
  no_answer: '模型无法作答',
  error: '请求失败',
  unauthorized: '未授权'
};

/**
 * 右侧详情; 父组件以 row.id 作 key, 切换记录时重置内部状态。
 * timeoutMs: 服务端当前的 LLM_TIMEOUT_MS, 未知时为 0 (不显示接近超时提示)
 */
export function Detail({
  row,
  timeoutMs,
  onZoom,
  onSaveVerified,
  onRemoveVerified
}: {
  row: LogRow;
  timeoutMs: number;
  onZoom: (t: ZoomTarget) => void;
  onSaveVerified: (row: LogRow, answers: string[], reason: string) => Promise<void>;
  onRemoveVerified: (row: LogRow) => Promise<void>;
}) {
  const [rawOpen, setRawOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const view = useMemo(() => analyzeRow(row), [row]);
  const [verifiedAnswers, setVerifiedAnswers] = useState(() => view.answers.join('\n'));
  const [verifiedReason, setVerifiedReason] = useState('');
  const [verifiedBusy, setVerifiedBusy] = useState(false);
  const [verifiedMessage, setVerifiedMessage] = useState('');
  const [verifiedError, setVerifiedError] = useState('');
  const tp = timeParts(row.ts);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  const copyJson = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(row, null, 2));
      setCopied(true);
    } catch {
      // 非安全上下文或无剪贴板权限
    }
  };

  const effort = row.think_effort || '默认';
  const steps = EFFORT_STEPS.includes(effort) ? EFFORT_STEPS : [...EFFORT_STEPS, effort];
  const calloutText = row.status === 'no_answer' ? row.reason || '模型未给出答案' : row.error;
  const level = latencyLevel(row.latency_ms, timeoutMs);
  const cacheRate = row.prompt_tokens > 0 ? `(${Math.round((row.cached_tokens / row.prompt_tokens) * 100)}%)` : '';

  const saveConfirmedAnswer = async () => {
    const answers = verifiedAnswers.split(/\r?\n/).map((answer) => answer.trim()).filter(Boolean);
    if (answers.length === 0) {
      setVerifiedError('请至少填写一个答案');
      setVerifiedMessage('');
      return;
    }
    setVerifiedBusy(true);
    setVerifiedError('');
    setVerifiedMessage('');
    try {
      await onSaveVerified(row, answers, verifiedReason.trim());
      setVerifiedMessage('已保存。之后遇到相同题目会优先使用此标准答案。');
    } catch (err: unknown) {
      setVerifiedError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifiedBusy(false);
    }
  };

  const forgetConfirmedAnswer = async () => {
    if (!window.confirm('移除这道题的人工确认答案？之后将重新调用模型作答。')) return;
    setVerifiedBusy(true);
    setVerifiedError('');
    setVerifiedMessage('');
    try {
      await onRemoveVerified(row);
      setVerifiedMessage('已移除人工确认答案。之后将重新调用模型作答。');
    } catch (err: unknown) {
      setVerifiedError(err instanceof Error ? err.message : String(err));
    } finally {
      setVerifiedBusy(false);
    }
  };

  return (
    <>
      <div className="detail-head">
        <span className={`badge badge-${row.status}`}>{STATUS_LABEL[row.status] ?? row.status}</span>
        <span className="tag">{typeLabel(row.question_type)}</span>
        {row.images > 0 && (
          <span className="tag">
            <IconImage size={14} />
            {row.images} 张图
          </span>
        )}
        <span className="muted mono">
          #{row.id} · {tp.date} {tp.time}
        </span>
        <span className="grow" />
        <button type="button" className="btn btn-sm" aria-pressed={rawOpen} onClick={() => setRawOpen(!rawOpen)}>
          {rawOpen ? '收起原始文本' : '原始文本'}
        </button>
        <button type="button" className="btn btn-sm" onClick={copyJson}>
          <span key={String(copied)} className="swap">
            {copied && <IconCheck size={14} />}
            {copied ? '已复制' : '复制 JSON'}
          </span>
        </button>
      </div>

      <h1 className={`q-title${plainText(row.title).length > 60 ? ' long' : ''}`}>
        {row.title ? <RichText text={row.title} onZoom={onZoom} /> : '（无题目）'}
      </h1>

      {view.options.length > 0 && (
        <div className="card options">
          {view.options.map((opt) => (
            <div key={opt.letter} className={`option${opt.selected ? ' picked' : ''}`}>
              <span className="letter">{opt.letter}</span>
              <span className="option-text">
                <RichText text={opt.text} onZoom={onZoom} />
              </span>
              {opt.selected && (
                <span className="picked-mark">
                  <IconCheck size={18} />
                  已选
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {view.blanks.length > 0 && (
        <div className="card blanks">
          <span className="card-label">
            {row.question_type === 'completion' ? '填空答案' : '答案'} · {view.blanks.length} 空
          </span>
          <div className="blank-grid">
            {view.blanks.map((text, i) => (
              <div key={i} className="blank">
                <span className="blank-n">空 {i + 1}</span>
                <span>
                  <RichText text={text} onZoom={onZoom} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {row.status !== 'ok' && (
        <div className={`callout callout-${row.status}`}>
          <IconAlert size={18} />
          <div className="callout-body">
            <strong>{CALLOUT_TITLE[row.status] ?? STATUS_LABEL[row.status] ?? row.status}</strong>
            <span>{calloutText || '—'}</span>
          </div>
        </div>
      )}

      <div className="info-row">
        <div className="card reason">
          <span className="card-label">模型理由</span>
          {row.reason ? (
            <p>{row.reason}</p>
          ) : (
            <p className="muted">{row.status === 'ok' ? '模型未给出理由' : '无（请求未完成，模型没有返回内容）'}</p>
          )}
        </div>
        <div className="card meta">
          <div className="meta-item span2">
            <span>模型</span>
            <span className="mono">{row.model || '—'}</span>
          </div>
          <div className="meta-item span2">
            <span>请求 IP</span>
            {row.ip ? <span className="mono">{row.ip}</span> : <span className="muted">未记录（旧记录）</span>}
          </div>
          <div className="meta-item">
            <span>耗时</span>
            <span
              className={`meta-value${level ? ` lat-${level}` : ''}`}
              title={level ? LATENCY_LABEL[level] : undefined}
            >
              {formatLatency(row.latency_ms)}
            </span>
          </div>
          <div className="meta-item">
            <span>图片</span>
            <span className="meta-value">{row.images > 0 ? `${row.images} 张` : '无'}</span>
          </div>
          <div className="meta-item">
            <span>Token 入 / 出</span>
            <span className="meta-value">
              {row.prompt_tokens} / {row.completion_tokens}
            </span>
          </div>
          <div className="meta-item">
            <span>缓存命中</span>
            <span className="meta-value">
              {row.cached_tokens} <span className="muted small">{cacheRate}</span>
            </span>
          </div>
          {level === 'near-timeout' && (
            <span className="span2 small lat-near-timeout">
              耗时接近 {Math.round(timeoutMs / 1000)} s 超时上限（LLM_TIMEOUT_MS），提高思考强度前建议调大
            </span>
          )}
          <div className="effort span2">
            <div className="effort-head">
              <span>
                思考强度 <span className="mono">thinkEffort</span>
              </span>
              <strong>{effort}</strong>
            </div>
            <div className="effort-steps" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
              {steps.map((step) => (
                <span key={step} className={`effort-step${step === effort ? ' on' : ''}`}>
                  {step}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <section className="card verified-answer-panel">
        <div>
          <strong>人工确认标准答案</strong>
          <p className="hint">只有确认正确后才保存；相同题目之后会优先使用此答案。每行一个答案，选择题可填选项字母或原文，填空题每空一行。</p>
        </div>
        <textarea
          value={verifiedAnswers}
          onChange={(e) => setVerifiedAnswers(e.target.value)}
          rows={Math.min(Math.max(verifiedAnswers.split(/\r?\n/).length, 2), 6)}
          placeholder="每行一个答案"
          aria-label="人工确认标准答案"
        />
        <input
          value={verifiedReason}
          onChange={(e) => setVerifiedReason(e.target.value)}
          maxLength={500}
          placeholder="备注（可选）"
          aria-label="标准答案备注"
        />
        <div className="verified-answer-actions">
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void saveConfirmedAnswer()} disabled={verifiedBusy}>
            {verifiedBusy ? '保存中…' : '保存并用于后续答题'}
          </button>
          <button type="button" className="btn btn-sm" onClick={() => void forgetConfirmedAnswer()} disabled={verifiedBusy}>
            移除确认答案
          </button>
          {verifiedMessage && <span className="verified-message">{verifiedMessage}</span>}
          {verifiedError && <span className="error-text">{verifiedError}</span>}
        </div>
      </section>

      {view.returned.length > 0 && (
        <div className="code">
          <span className="code-label">
            {view.returnedIsMsg ? '返回给 OCS 的 msg（code: 1）' : '返回给 OCS 的答案字符串（多个答案以 # 分隔）'}
          </span>
          <code>
            {view.returned.map((part, i) => (
              <span key={i}>
                {i > 0 && <span className="sep">#</span>}
                {part}
              </span>
            ))}
          </code>
        </div>
      )}

      {rawOpen && (
        <div className="code">
          <span className="code-label">OCS 发来的原始文本（图片以网址形式夹在文字中）</span>
          <dl className="raw-grid">
            <dt>title</dt>
            <dd>{row.title || '（空）'}</dd>
            <dt>options</dt>
            <dd>{row.options || '（空）'}</dd>
          </dl>
        </div>
      )}
    </>
  );
}
