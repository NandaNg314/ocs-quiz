# OCS Quiz 多模型保存与热切换使用指南

本项目已全面支持 **多模型配置保存** 与 **后台一键热切换（Hot-Switching）**。当某个大模型（如 DeepSeek）的 API 额度不足或被限流时，你只需在网页后台点击一下「设为激活」，无需重新配置油猴/脚本猫插件，下一道网课题目将立即无缝使用新模型作答。

---

## 一、 核心工作架构

```
┌─────────────────────────────────────────────────────────────┐
│ 1. 网页管理后台 (WebUI - 托管在 Worker 根路径 /)             │
│    • 保存多个模型配置（DeepSeek、硅基流动、通义千问、OpenAI 等）   │
│    • 连通性测速：随时检测 API Key 是否有效、网络延迟            │
│    • 一键热切换：点击「设为激活」，毫秒级写入 Cloudflare D1      │
└──────────────────────────┬──────────────────────────────────┘
                           │ 实时读写 D1 数据库 (models 表)
┌──────────────────────────▼──────────────────────────────────┐
│ 2. Cloudflare Worker 搜题后端 (/api/search)                 │
│    • 接收 OCS 网课助手发来的题目                             │
│    • 优先从 D1 提取当前激活的模型配置（自动托管模式）             │
│    • 转交对应大模型作答，解析并清洗答案回传                     │
└──────────────────────────▲──────────────────────────────────┘
                           │ HTTP POST 搜题
┌──────────────────────────┴──────────────────────────────────┐
│ 3. OCS 网课助手（油猴 / 脚本猫插件）                          │
│    • 只需在题库中配置一次 Worker 托管规则                      │
│    • 插件端不再硬编码写死 apiKey / model，省去繁琐改动          │
└─────────────────────────────────────────────────────────────┘
```

---

## 二、 Cloudflare Worker 后台变量与配置清单

在部署与使用之前，请根据下表核对你的 Cloudflare Worker 配置：

### 1. 核心密码与机密 (Secrets)

这两个变量是 **必须设置的敏感安全口令**，通过命令行或 Cloudflare 控制台添加：

| 变量名称 | 必须程度 | 设置命令 | 用途与说明 |
| :--- | :---: | :--- | :--- |
| **`AUTH_TOKEN`** | **强烈推荐** | `npx wrangler secret put AUTH_TOKEN` | 搜题接口鉴权 Token。用于填入 OCS 插件题库配置中，防止他人扫描或蹭用你的 Worker 消耗额度。 |
| **`WEBUI_TOKEN`** | **必填** | `npx wrangler secret put WEBUI_TOKEN` | 管理看板登录口令。访问网页看日志、添加模型、热切换模型时输入的身份口令。 |

> **网页后台设置路径**：Cloudflare 仪表盘 → **Workers 和 Pages** → 点击你的 Worker 项目 → **Settings（设置）** → **Variables and Secrets（变量和机密）** → 点击 **Add（添加）** 并选择机密类型。

### 2. D1 数据库绑定（必须属于你自己的账号）

打开项目根目录下的 [`wrangler.toml`](./wrangler.toml)：

```toml
[[d1_databases]]
binding = "DB"
database_name = "ocs-quiz-db"
database_id = "这里一定要替换为你自己账号下的 database_id"
```

- **特别注意**：如果是刚刚克隆的项目，文件中的 `database_id` 为原作者的示例 ID。你在部署时会因为没有该数据库权限而报错。
- **创建属于自己的 D1 数据库**：
  ```bash
  npx wrangler d1 create ocs-quiz-db
  ```
  执行后终端会输出一个 `database_id`，将它复制并替换到 `wrangler.toml` 中即可。
- **免手动建表**：代码内置了自动幂等建表逻辑，部署后 Worker 首次收到请求就会自动创建 `logs` 与 `models` 表，无需手动执行 SQL。

### 3. 大模型自己的 API Key 需要在 Cloudflare 后台设置吗？

**完全不需要！**
- 这正是本次改造的核心优势：所有大模型的 API Key、Base URL 和模型名称**全部由 D1 数据库持久化托管**。
- 你只需在浏览器打开管理后台，在「模型管理」页面录入并切换，随时添加新模型或修改 Key，**不需要每次改动都在 Cloudflare 后台重新部署**。

### 4. 可选全局参数（已有默认值，无需额外修改）

在 `wrangler.toml` 的 `[vars]` 中已预设合理参数：
- `LLM_TEMPERATURE = "0"`：建议保持 0，以确保搜题输出严谨稳定。
- `LLM_TIMEOUT_MS = "110000"`：单次请求超时时间（110 秒），适配网课平台倒计时。
- `VISION_ENABLED = "true"`：开启多模态图片识别。
- `LOG_ENABLED = "true"`：记录搜题日志。

---

## 三、 部署与更新步骤

在项目根目录下执行以下命令即可完成前端构建与 Worker 部署：

```bash
# 1. 构建 Web 前端页面
npm run build:web

# 2. 一键发布部署到 Cloudflare Workers
npm run deploy
```

---

## 四、 使用流程

### 第一步：在 Web 后台添加与管理模型

1. 浏览器打开你的 Worker 域名（例如 `https://quiz.example.com`）。
2. 输入部署时设置的 `WEBUI_TOKEN` 登录管理看板。
3. 点击顶部导航栏的 **「模型管理」** 标签页。
4. 点击 **「+ 添加模型配置」**：
   - 弹窗顶部提供常用模板快捷按钮（**DeepSeek 官方 Chat**、**DeepSeek R1 深度思考**、**硅基流动**、**阿里通义千问**、**OpenAI** 等），点击即可自动填入 Base URL 与推荐 Model ID。
   - 填入对应服务商的 `API Key`。
   - 可选填入思考强度（如 `low`、`high`）。
   - 点击 **「测试连接」**，确认网络连通与密钥有效性。
   - 勾选「保存后立即设为全局激活模型」，点击保存。
5. 你可以按照同样方式添加多个备用模型（如 DeepSeek 官方账号、硅基流动备用、通义千问备用等）。

---

### 第二步：配置 OCS 网课助手（仅需配置一次）

在网页后台的「模型管理」页面，点击 **「查看 OCS 题库配置」**，或直接复制下方 JSON：

```json
[
  {
    "name": "OCS Quiz (Worker 热托管)",
    "homepage": "https://<你的域名>",
    "url": "https://<你的域名>/api/search",
    "method": "post",
    "contentType": "json",
    "type": "GM_xmlhttpRequest",
    "headers": {
      "Content-Type": "application/json",
      "Authorization": "Bearer <YOUR_AUTH_TOKEN>"
    },
    "data": {
      "title": "${title}",
      "options": "${options}",
      "type": "${type}"
    },
    "handler": "return (res)=> res.code === 0 ? [res.data.question, res.data.answers.join('#')] : [res.msg, undefined]"
  }
]
```

#### 配置注意事项：
- 将其中的 `https://<你的域名>` 换成你的 Cloudflare Worker 域名（例如 `https://quiz.example.com`）。
- 将其中的 `<YOUR_AUTH_TOKEN>` 替换为你在 Cloudflare 中设置的 `AUTH_TOKEN`。
- 打开网课答题页面，点击 OCS 悬浮窗的 **「设置」 -> 「题库配置」**，粘贴上述配置并保存即可。

---

### 第三步：日常使用与额度不足时热切换

平时刷课做题过程中：

1. **正常做题**：OCS 发送题目，Worker 会全自动调用当前激活的模型作答。
2. **额度耗尽 / 报错时**：
   - 手机或电脑随时打开后台管理页。
   - 在已保存的模型列表中，找到有额度的备用模型卡片。
   - 点击卡片右上角的 **【⚡ 设为激活】**。
   - 页面提示“已热切换”，**油猴脚本端完全不用动**，下一道题目就会立即无缝使用新模型作答！

---

## 五、 防御性加固与特性设计

本次改造在底层融入了以下安全与健壮性机制，防止日常使用报错：

1. **Base URL 智能清洗与容错**：
   - 无论用户输入带有末尾斜杠（如 `https://api.deepseek.com/`），还是误粘了完整接口路径（如 `https://api.openai.com/v1/chat/completions`），后端都会自动规整化，杜绝双斜杠导致 404 的问题。
2. **Key 前端脱敏与服务端安全测速**：
   - 模型列表展示时 API Key 自动脱敏为 `sk-****1234`，防止屏幕录屏泄露。
   - 在列表卡片点击「测速连接」时，由 Cloudflare 边缘节点直接读取 D1 原文发起轻量握手验证，既安全又保证测速 100% 真实有效。
3. **友好中文报错反馈**：
   - 若未配置或未激活任何模型，Worker 会直接向 OCS 返回友好的中文提示并在插件面板显示，避免无意义的“题库连接失败”。
4. **URL 路由转义支持**：
   - 激活与删除接口全面增加 `decodeURIComponent`，兼容带有特殊字符的模型 ID。

---

## 六、 核心修改文件一览

| 模块 / 文件 | 说明 |
| --- | --- |
| [`schema.sql`](./schema.sql) | 新增 `models` 表结构定义 |
| [`src/models.ts`](./src/models.ts) | 模型数据库访问层、自动幂等建表、CRUD、连通性测试与激活逻辑 |
| [`src/http.ts`](./src/http.ts) | 放行 PUT、DELETE 跨域方法 |
| [`src/index.ts`](./src/index.ts) | 注册 `/api/models` 管理路由，`/api/search` 支持优先取激活模型回退 |
| [`web/src/ModelHub.tsx`](./web/src/ModelHub.tsx) | 模型管理前端组件（卡片网格、一键热切换、常用模板、连通性测速） |
| [`web/src/App.tsx`](./web/src/App.tsx) | 顶部 Tab 切换（答题日志 ⇋ 模型管理）与视图整合 |
| [`web/src/app.css`](./web/src/app.css) | 配套的主题样式、响应式布局、状态光晕与操作动效 |
