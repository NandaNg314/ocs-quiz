import { useEffect, useState } from 'react';
import {
  IconAlert,
  IconBolt,
  IconCheck,
  IconClose,
  IconCopy,
  IconCpu,
  IconEdit,
  IconPlus,
  IconRefresh,
  IconServer,
  IconTrash
} from './icons';

export interface ModelItem {
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

interface ModelHubProps {
  token: string;
}

const PRESETS = [
  {
    label: 'DeepSeek 官方 (Chat)',
    name: 'DeepSeek 官方主力',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-chat',
    thinkEffort: ''
  },
  {
    label: 'DeepSeek 深度思考 (R1)',
    name: 'DeepSeek R1 满血版',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-reasoner',
    thinkEffort: ''
  },
  {
    label: '硅基流动 (DeepSeek V3)',
    name: '硅基流动 备用',
    baseUrl: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    thinkEffort: ''
  },
  {
    label: '阿里百炼 (Qwen Plus)',
    name: '通义千问 Plus',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    thinkEffort: ''
  },
  {
    label: 'OpenAI (GPT-4o mini)',
    name: 'OpenAI 4o-mini',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    thinkEffort: ''
  }
];

export function ModelHub({ token }: ModelHubProps) {
  const [models, setModels] = useState<ModelItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');

  // 正在切换激活的模型 ID
  const [activatingId, setActivatingId] = useState<string | null>(null);

  // 正在测试的模型 ID
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string; latencyMs?: number }>>({});

  // 弹窗编辑/新建
  const [editItem, setEditItem] = useState<{
    id?: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    model: string;
    thinkEffort: string;
    isActive: boolean;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalTestLoading, setModalTestLoading] = useState(false);
  const [modalTestResult, setModalTestResult] = useState<{ ok: boolean; msg: string; latencyMs?: number } | null>(null);

  // OCS 配置生成弹窗
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchModels = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/models', {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = (await res.json()) as { code: number; data?: ModelItem[]; msg?: string };
      if (data.code === 0 && Array.isArray(data.data)) {
        setModels(data.data);
      } else {
        setError(data.msg || '获取模型列表失败');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchModels();
  }, [token]);

  // 设为激活（热切换）
  const handleActivate = async (m: ModelItem) => {
    if (m.isActive) return;
    setActivatingId(m.id);
    setError('');
    try {
      const res = await fetch(`/api/models/${encodeURIComponent(m.id)}/active`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = (await res.json()) as { code: number; msg?: string };
      if (data.code === 0) {
        setModels((prev) =>
          prev.map((item) => ({
            ...item,
            isActive: item.id === m.id
          }))
        );
        setMsg(`已热切换到模型：${m.name}（${m.model}），下次搜题即刻生效！`);
        setTimeout(() => setMsg(''), 4000);
      } else {
        setError(data.msg || '切换激活失败');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActivatingId(null);
    }
  };

  // 快速连通性测试
  const handleTest = async (m: ModelItem) => {
    setTestingId(m.id);
    setTestResult((prev) => {
      const next = { ...prev };
      delete next[m.id];
      return next;
    });

    try {
      const res = await fetch('/api/models/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ id: m.id })
      });
      const data = (await res.json()) as {
        code: number;
        data?: { ok: boolean; msg: string; latencyMs: number };
        msg?: string;
      };
      if (data.code === 0 && data.data) {
        setTestResult((prev) => ({ ...prev, [m.id]: data.data! }));
      } else {
        setTestResult((prev) => ({
          ...prev,
          [m.id]: { ok: false, msg: data.msg || '连接失败' }
        }));
      }
    } catch (err: unknown) {
      setTestResult((prev) => ({
        ...prev,
        [m.id]: { ok: false, msg: err instanceof Error ? err.message : String(err) }
      }));
    } finally {
      setTestingId(null);
    }
  };

  // 删除模型
  const handleDelete = async (m: ModelItem) => {
    if (!window.confirm(`确定删除模型配置「${m.name}」吗？`)) return;
    try {
      const res = await fetch(`/api/models/${encodeURIComponent(m.id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = (await res.json()) as { code: number; msg?: string };
      if (data.code === 0) {
        void fetchModels();
      } else {
        setError(data.msg || '删除失败');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // 弹窗内的连通性测试
  const handleModalTest = async () => {
    if (!editItem?.baseUrl || !editItem?.model) {
      setModalTestResult({ ok: false, msg: '请先填写 Base URL 和 Model' });
      return;
    }
    if (!editItem.id && !editItem.apiKey) {
      setModalTestResult({ ok: false, msg: '新建时必须填写 API Key 才能测试' });
      return;
    }

    setModalTestLoading(true);
    setModalTestResult(null);

    try {
      const res = await fetch('/api/models/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          id: editItem.id,
          baseUrl: editItem.baseUrl,
          apiKey: editItem.apiKey,
          model: editItem.model
        })
      });
      const data = (await res.json()) as {
        code: number;
        data?: { ok: boolean; msg: string; latencyMs: number };
        msg?: string;
      };
      if (data.code === 0 && data.data) {
        setModalTestResult(data.data);
      } else {
        setModalTestResult({ ok: false, msg: data.msg || '测试失败' });
      }
    } catch (err: unknown) {
      setModalTestResult({ ok: false, msg: err instanceof Error ? err.message : String(err) });
    } finally {
      setModalTestLoading(false);
    }
  };

  // 保存模型
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editItem) return;
    setSaving(true);
    setError('');

    try {
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify(editItem)
      });
      const data = (await res.json()) as { code: number; data?: ModelItem; msg?: string };
      if (data.code === 0) {
        setEditItem(null);
        void fetchModels();
        setMsg(editItem.id ? '模型配置已更新' : '已成功添加新模型');
        setTimeout(() => setMsg(''), 3000);
      } else {
        setError(data.msg || '保存失败');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const activeModel = models.find((m) => m.isActive);

  // 构造 OCS 题库配置 JSON 文本
  const ocsConfigText = JSON.stringify(
    [
      {
        name: 'OCS Quiz (Worker 热托管)',
        homepage: window.location.origin,
        url: `${window.location.origin}/api/search`,
        method: 'post',
        contentType: 'json',
        type: 'GM_xmlhttpRequest',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer <YOUR_AUTH_TOKEN>'
        },
        data: {
          title: '${title}',
          options: '${options}',
          type: '${type}'
        },
        handler: "return (res)=> res.code === 0 ? [res.data.question, res.data.answers.join('#')] : [res.msg, undefined]"
      }
    ],
    null,
    2
  );

  return (
    <div className="model-hub">
      {/* 顶部提示横幅 */}
      {msg && <div className="banner-success">{msg}</div>}
      {error && <div className="banner-error">{error}</div>}

      {/* 激活模型 Hero 区域 */}
      <section className="active-hero">
        <div className="active-hero-main">
          <div className="active-badge-tag">
            <span className="live-dot" />
            当前全局生效模型
          </div>
          {activeModel ? (
            <div className="active-info">
              <h2 className="active-title">{activeModel.name}</h2>
              <div className="active-meta">
                <span className="chip chip-model">
                  <IconCpu size={13} /> {activeModel.model}
                </span>
                <span className="chip chip-url">
                  <IconServer size={13} /> {activeModel.baseUrl}
                </span>
                {activeModel.thinkEffort && (
                  <span className="chip chip-effort">
                    <IconBolt size={13} /> 思考强度: {activeModel.thinkEffort}
                  </span>
                )}
              </div>
              <p className="active-desc">
                OCS 网课搜题时，将自动使用此模型。额度不足时，只需在下方列表中找到备用模型，点击
                <strong>「设为激活」</strong>即可热切换，插件端无需做任何调整。
              </p>
            </div>
          ) : (
            <div className="active-empty">
              <p>尚未激活任何模型！请在下方添加或选择一个模型设为激活。</p>
            </div>
          )}
        </div>

        <div className="active-hero-actions">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              setEditItem({
                name: '',
                baseUrl: '',
                apiKey: '',
                model: '',
                thinkEffort: '',
                isActive: models.length === 0
              });
              setModalTestResult(null);
            }}
          >
            <IconPlus size={16} /> 添加模型配置
          </button>
          <button type="button" className="btn" onClick={() => setShowConfigModal(true)}>
            <IconCopy size={16} /> 查看 OCS 题库配置
          </button>
          <button type="button" className="btn icon-btn" onClick={fetchModels} disabled={loading} title="刷新列表">
            <IconRefresh />
          </button>
        </div>
      </section>

      {/* 模型列表 */}
      <section className="model-list-section">
        <div className="section-head">
          <h3>已保存的模型配置 ({models.length})</h3>
          <span className="muted small">点击卡片右上角按钮即可随时切换激活模型</span>
        </div>

        {models.length === 0 && !loading && (
          <div className="empty-box">
            <IconServer size={32} />
            <p>暂无模型配置，点击上方「添加模型配置」开始使用吧</p>
          </div>
        )}

        <div className="model-cards-grid">
          {models.map((m) => {
            const isActivating = activatingId === m.id;
            const isTesting = testingId === m.id;
            const test = testResult[m.id];

            return (
              <div key={m.id} className={`model-card${m.isActive ? ' is-active' : ''}`}>
                <div className="card-top">
                  <div className="card-title-group">
                    <h4 className="card-name">{m.name}</h4>
                    <span className="card-model-code">{m.model}</span>
                  </div>
                  {m.isActive ? (
                    <span className="status-badge active">
                      <IconCheck size={12} /> 生效中
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="btn btn-sm btn-activate"
                      disabled={isActivating}
                      onClick={() => handleActivate(m)}
                      title="点击立即切换为此模型"
                    >
                      <IconBolt size={13} /> {isActivating ? '切换中…' : '设为激活'}
                    </button>
                  )}
                </div>

                <div className="card-body">
                  <div className="card-prop">
                    <span className="prop-label">Base URL:</span>
                    <span className="prop-value" title={m.baseUrl}>
                      {m.baseUrl}
                    </span>
                  </div>
                  <div className="card-prop">
                    <span className="prop-label">API Key:</span>
                    <span className="prop-value font-mono">{m.apiKeyMasked}</span>
                  </div>
                  {m.thinkEffort && (
                    <div className="card-prop">
                      <span className="prop-label">思考强度:</span>
                      <span className="prop-value">{m.thinkEffort}</span>
                    </div>
                  )}
                </div>

                {/* 测试结果气泡 */}
                {test && (
                  <div className={`test-result-inline ${test.ok ? 'ok' : 'err'}`}>
                    {test.ok ? (
                      <>
                        <IconCheck size={13} /> 连通正常 {test.latencyMs ? `(${test.latencyMs}ms)` : ''}
                      </>
                    ) : (
                      <>
                        <IconAlert size={13} /> {test.msg}
                      </>
                    )}
                  </div>
                )}

                <div className="card-footer">
                  <button
                    type="button"
                    className="btn btn-sm"
                    disabled={isTesting}
                    onClick={() => handleTest(m)}
                    title="发送测试请求，检查 Key 和网络是否正常"
                  >
                    {isTesting ? '测试中…' : '测速连接'}
                  </button>
                  <div className="card-actions-right">
                    <button
                      type="button"
                      className="btn btn-sm icon-btn"
                      onClick={() => {
                        setEditItem({
                          id: m.id,
                          name: m.name,
                          baseUrl: m.baseUrl,
                          apiKey: '', // 编辑时默认不回显，保留原值
                          model: m.model,
                          thinkEffort: m.thinkEffort,
                          isActive: m.isActive
                        });
                        setModalTestResult(null);
                      }}
                      title="编辑配置"
                    >
                      <IconEdit size={14} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm icon-btn btn-danger-icon"
                      onClick={() => handleDelete(m)}
                      title="删除模型"
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 新建/编辑模型弹窗 */}
      {editItem && (
        <div className="modal-backdrop" onClick={() => !saving && setEditItem(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>{editItem.id ? '编辑模型配置' : '添加新模型配置'}</h3>
              <button
                type="button"
                className="btn icon-btn"
                onClick={() => setEditItem(null)}
                disabled={saving}
                aria-label="关闭"
              >
                <IconClose />
              </button>
            </div>

            <form onSubmit={handleSave}>
              {/* 快速模板 */}
              <div className="presets-bar">
                <span className="muted small">快捷填入常用模板:</span>
                <div className="presets-btns">
                  {PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      className="btn btn-xs preset-btn"
                      onClick={() => {
                        setEditItem((prev) =>
                          prev
                            ? {
                                ...prev,
                                name: prev.name || p.name,
                                baseUrl: p.baseUrl,
                                model: p.model,
                                thinkEffort: p.thinkEffort
                              }
                            : null
                        );
                      }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="form-group">
                <label>配置名称 (备注)</label>
                <input
                  type="text"
                  required
                  placeholder="例如: DeepSeek 官方主力"
                  value={editItem.name}
                  onChange={(e) => setEditItem({ ...editItem, name: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>Base URL (API 地址)</label>
                <input
                  type="url"
                  required
                  placeholder="https://api.deepseek.com"
                  value={editItem.baseUrl}
                  onChange={(e) => setEditItem({ ...editItem, baseUrl: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label>
                  API Key
                  {editItem.id && <span className="muted small font-normal"> (若不修改则留空)</span>}
                </label>
                <input
                  type="password"
                  placeholder={editItem.id ? '留空表示使用现有 Key' : 'sk-xxxx...'}
                  required={!editItem.id}
                  value={editItem.apiKey}
                  onChange={(e) => setEditItem({ ...editItem, apiKey: e.target.value })}
                />
              </div>

              <div className="form-row">
                <div className="form-group flex-2">
                  <label>模型名称 (Model ID)</label>
                  <input
                    type="text"
                    required
                    placeholder="deepseek-chat 或 gpt-4o-mini"
                    value={editItem.model}
                    onChange={(e) => setEditItem({ ...editItem, model: e.target.value })}
                  />
                </div>
                <div className="form-group flex-1">
                  <label>思考强度 (可选)</label>
                  <input
                    type="text"
                    placeholder="如 low / high"
                    value={editItem.thinkEffort}
                    onChange={(e) => setEditItem({ ...editItem, thinkEffort: e.target.value })}
                  />
                </div>
              </div>

              <div className="form-check">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={editItem.isActive}
                    onChange={(e) => setEditItem({ ...editItem, isActive: e.target.checked })}
                  />
                  保存后立即设为全局激活模型
                </label>
              </div>

              {/* 弹窗测试反馈 */}
              {modalTestResult && (
                <div className={`test-feedback-box ${modalTestResult.ok ? 'ok' : 'err'}`}>
                  {modalTestResult.ok ? (
                    <span>✓ 测试连通正常，耗时 {modalTestResult.latencyMs}ms</span>
                  ) : (
                    <span>✕ 测试失败: {modalTestResult.msg}</span>
                  )}
                </div>
              )}

              <div className="modal-footer">
                <button
                  type="button"
                  className="btn"
                  onClick={handleModalTest}
                  disabled={modalTestLoading || saving}
                >
                  {modalTestLoading ? '测试连接中…' : '测试连接'}
                </button>
                <div className="modal-footer-right">
                  <button type="button" className="btn" onClick={() => setEditItem(null)} disabled={saving}>
                    取消
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={saving}>
                    {saving ? '保存中…' : '保存配置'}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* OCS 配置弹窗 */}
      {showConfigModal && (
        <div className="modal-backdrop" onClick={() => setShowConfigModal(false)}>
          <div className="modal-content ocs-config-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>OCS 题库配置 (服务端托管模式)</h3>
              <button
                type="button"
                className="btn icon-btn"
                onClick={() => setShowConfigModal(false)}
                aria-label="关闭"
              >
                <IconClose />
              </button>
            </div>
            <div className="modal-body">
              <p className="muted small">
                在 OCS 网课助手设置中的<strong>「题库配置」</strong>粘贴下方配置。
                注意将其中的 <code>&lt;YOUR_AUTH_TOKEN&gt;</code> 替换为你部署 Worker 时的 <code>AUTH_TOKEN</code>。
              </p>
              <div className="code-box-wrapper">
                <pre className="code-box">{ocsConfigText}</pre>
                <button
                  type="button"
                  className="btn btn-sm copy-btn"
                  onClick={() => {
                    void navigator.clipboard.writeText(ocsConfigText);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? (
                    <>
                      <IconCheck size={14} /> 已复制
                    </>
                  ) : (
                    <>
                      <IconCopy size={14} /> 复制 JSON
                    </>
                  )}
                </button>
              </div>
              <p className="tip-text">
                💡 <strong>优势说明</strong>：此配置下，模型 Key 和地址由当前 Worker 完全接管。
                平时额度不够时，直接在网页上点击切换模型即可，油猴脚本里永久不需要再改动！
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
