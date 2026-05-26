# AI Coding 订阅/余额 API 文档合集

涵盖以下 Provider 的配额查询方法，统一采用**两级认证**策略：

1. **环境变量**（优先）
2. **auth.json** 回退（`~/.local/share/opencode/auth.json`）

---

## 认证总览

### auth.json 位置

| 平台 | 路径 |
|------|------|
| Linux | `~/.local/share/opencode/auth.json` |
| macOS | `~/.local/share/opencode/auth.json` 或 `~/Library/Application Support/opencode/auth.json` |
| Windows | `%APPDATA%/opencode/auth.json` 或 `%LOCALAPPDATA%/opencode/auth.json` |

如设了 `XDG_DATA_HOME`，则为 `$XDG_DATA_HOME/opencode/auth.json`。

### auth.json 结构

```json
{
  "zai-coding-plan": {
    "type": "api",
    "key": "xxxxxxxx"
  },
  "openai": {
    "type": "oauth",
    "access": "eyJ...",
    "refresh": "eyJ...",
    "expires": 1700000000000,
    "accountId": "acct-xxx"
  }
}
```

- **API 类型**：`type: "api"`，取 `.key` 字段
- **OAuth 类型**：`type: "oauth"`，取 `.access` 字段（JWT），另有 `.refresh`、`.expires`

### 通用认证解析优先级

```
1. 环境变量（各 provider 专用）
2. opencode.json 中的 provider.options.apiKey（支持 {env:VAR} 模板）
3. auth.json 回退
```

---

## Provider 总览

| Provider | API 类型 | 环境变量 | auth.json Key | 数据维度 |
|----------|---------|---------|---------------|---------|
| GLM Coding Plan | REST | `ZHIPU_API_KEY` | `zai-coding-plan` / `zhipu-coding-plan` | 5h Token% + 月度时长% |
| Kimi Code | REST | `KIMI_API_KEY` | `kimi-for-coding` | 用量/限额 + 重置时间 |
| MiniMax CN | REST | `MINIMAX_CHINA_CODING_PLAN_API_KEY` | `minimax-china-coding-plan` | 5h + 周，按模型分组 |
| DeepSeek | REST | `DEEPSEEK_API_KEY` | `deepseek` | 仅余额（CNY/USD） |
| OpenCode Go | HTML 爬取 | `OPENCODE_GO_WORKSPACE_ID` + `OPENCODE_GO_AUTH_COOKIE` | 不使用 | 5h/周/月 用量% |
| OpenRouter | REST | `OPENROUTER_API_KEY` | 不使用 | 余额 + 日/周/月用量 |
| OpenCode Zen | **无 API** | `OPENCODE_API_KEY` | `opencode` | 仅有 #10448 提议 |
| OpenAI OAuth | REST (OAuth) | 不适用 | `openai` (oauth) | 5h/周/代码审查 用量% |

---

# 1. GLM Coding Plan (Z.AI / 智谱)

## 概述

GLM Coding Plan 提供 3 个 REST API 查询订阅用量和余额，均为 HTTPS GET。

## 认证

**优先级：**

| 优先级 | 来源 | Key |
|--------|------|-----|
| 1 | 环境变量 | `ZAI_API_KEY` 或 `ZAI_CODING_PLAN_API_KEY` 或 `ZHIPU_API_KEY` |
| 2 | opencode.json | `provider.zai.options.apiKey` 或 `provider.zai-coding-plan.options.apiKey` |
| 3 | auth.json | `zai-coding-plan` → `.key` |

**Zhipu 国内站额外 key：**

| 优先级 | 来源 | Key |
|--------|------|-----|
| 1 | 环境变量 | `ZHIPU_API_KEY` 或 `ZHIPU_CODING_PLAN_API_KEY` |
| 2 | opencode.json | `provider.zhipu.options.apiKey` 或 `provider.zhipu-coding-plan.options.apiKey` |
| 3 | auth.json | `zhipu-coding-plan` 或 `zhipuai-coding-plan` → `.key` |

**请求头：**

```
Authorization: <token>
Accept-Language: en-US,en
Content-Type: application/json
```

注意：不需要 `Bearer` 前缀。

## 平台与 Base URL

| Provider ID | Base URL | 说明 |
|---|---|---|
| `zai` | `https://api.z.ai` | Z.AI 国际站按量 |
| `zai-coding-plan` | `https://api.z.ai` | Z.AI 国际站订阅 |
| `zhipuai` | `https://open.bigmodel.cn` | 智谱国内站按量 |
| `zhipuai-coding-plan` | `https://open.bigmodel.cn` | 智谱国内站订阅 |

插件通过 `client.config.get()` 读取当前 `model` 字段（如 `zai-coding-plan/glm-5.1`），从 provider ID 前缀推断 base URL。

## API 详情

### 1.1 配额/余额限制查询

```
GET {baseDomain}/api/monitor/usage/quota/limit
```

**不需要 Query 参数。**

**响应结构：**

```json
{
  "data": {
    "limits": [
      {
        "type": "TOKENS_LIMIT",
        "percentage": 45.2
      },
      {
        "type": "TIME_LIMIT",
        "percentage": 30.1,
        "currentValue": 1800,
        "usage": 6000,
        "usageDetails": "..."
      }
    ]
  }
}
```

**limits 字段说明：**

| type | 字段 | 说明 |
|------|------|------|
| `TOKENS_LIMIT` | `percentage` | 5h 滑动窗口已用百分比 |
| `TIME_LIMIT` | `percentage` | 月度时长已用百分比 |
| `TIME_LIMIT` | `currentValue` | 当前已使用量 |
| `TIME_LIMIT` | `usage` | 总配额 |

### 1.2 模型用量查询

```
GET {baseDomain}/api/monitor/usage/model-usage?startTime=<encoded>&endTime=<encoded>
```

时间参数格式 `yyyy-MM-dd HH:mm:ss`，需 URL Encode。

### 1.3 工具用量查询

```
GET {baseDomain}/api/monitor/usage/tool-usage?startTime=<encoded>&endTime=<encoded>
```

参数与模型用量查询相同。

## 伪代码

```typescript
const endpoints: Record<string, string> = {
  "zai":                 "https://api.z.ai",
  "zai-coding-plan":     "https://api.z.ai",
  "zhipuai":             "https://open.bigmodel.cn",
  "zhipuai-coding-plan": "https://open.bigmodel.cn",
}

const providerId = currentModel.split("/")[0]
const base = endpoints[providerId]
const token = process.env.ZHIPU_API_KEY
  || readAuthJson("zai-coding-plan")?.key
  || readAuthJson("zhipu-coding-plan")?.key

const res = await fetch(`${base}/api/monitor/usage/quota/limit`, {
  headers: { Authorization: token, "Content-Type": "application/json" },
})
const { data } = await res.json()
const tokensPct = data.limits.find((l: any) => l.type === "TOKENS_LIMIT")?.percentage
const timePct = data.limits.find((l: any) => l.type === "TIME_LIMIT")?.percentage
```

---

# 2. Kimi Code

## 概述

Kimi Code 订阅提供用量查询 API，返回当前套餐使用量和限额。

## 认证

**优先级：**

| 优先级 | 来源 | Key |
|--------|------|-----|
| 1 | 环境变量 | `KIMI_API_KEY` 或 `KIMI_CODE_API_KEY` |
| 2 | opencode.json | `provider["kimi-for-coding"].options.apiKey` |
| 3 | auth.json | `kimi-for-coding` 或 `kimi-code` 或 `kimi` → `.key` |

**请求头：**

```
Authorization: Bearer <token>
User-Agent: OpenCode-Quota-Toast/1.0
```

需要 `Bearer ` 前缀。

## API 详情

### 2.1 用量查询

```
GET https://api.kimi.com/coding/v1/usages
```

**不需要 Query 参数。**

**响应结构：**

```json
{
  "data": {
    "usage": {
      "limit": 100,
      "used": 45,
      "name": "Kimi Code",
      "reset_at": "2026-06-01T00:00:00Z"
    },
    "limits": [
      {
        "name": "rolling",
        "detail": {
          "limit": 100,
          "used": 45,
          "name": "Kimi Code"
        },
        "window": {
          "duration": 5,
          "timeUnit": "HOUR"
        }
      }
    ]
  }
}
```

**字段说明：**

| 字段路径 | 类型 | 说明 |
|---------|------|------|
| `data.usage.limit` | number | 总配额 |
| `data.usage.used` | number | 已使用量（也可能是 `remaining`） |
| `data.usage.reset_at` | string | 重置时间 ISO（也可能是 `resetAt`/`reset_time`/`resetTime`） |
| `data.limits[].window.duration` | number | 窗口时长 |
| `data.limits[].window.timeUnit` | string | `MINUTE` / `HOUR` / `DAY` |

**注意：** 响应字段名有多种变体，解析时需兼容 `used` vs `remaining`、`reset_at` vs `resetAt` vs `reset_time` 等。

## 伪代码

```typescript
const token = process.env.KIMI_API_KEY || readAuthJson("kimi-for-coding")?.key
const res = await fetch("https://api.kimi.com/coding/v1/usages", {
  headers: { Authorization: `Bearer ${token}` },
})
const payload = await res.json()
const usage = payload.data?.usage || payload.usage
const used = usage.used ?? (usage.limit - (usage.remaining ?? 0))
const pctUsed = (used / usage.limit) * 100
```

---

# 3. MiniMax Coding Plan (CN)

## 概述

MiniMax 国内站提供订阅剩余量查询 API，返回各模型在 5 小时和周维度上的用量。

## 认证

**优先级：**

| 优先级 | 来源 | Key |
|--------|------|-----|
| 1 | 环境变量 | `MINIMAX_CHINA_CODING_PLAN_API_KEY` |
| 2 | opencode.json | `provider["minimax-china-coding-plan"].options.apiKey` |
| 3 | auth.json | `minimax-china-coding-plan` 或 `minimax-cn-coding-plan` → `.key` |

**请求头：**

```
Authorization: Bearer <token>
User-Agent: OpenCode-Quota-Toast/1.0
```

## API 详情

### 3.1 订阅剩余量查询

```
GET https://api.minimaxi.com/v1/token_plan/remains
```

**不需要 Query 参数。**

**响应结构：**

```json
{
  "model_remains": [
    {
      "model_name": "MiniMax-M*",
      "current_interval_total_count": 100,
      "current_interval_usage_count": 30,
      "remains_time": 18000,
      "current_weekly_total_count": 500,
      "current_weekly_usage_count": 150,
      "weekly_remains_time": 432000
    }
  ],
  "base_resp": {
    "status_code": 0,
    "status_msg": "success"
  }
}
```

**字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `model_name` | string | 模型名，`MiniMax-M*` 为通配 |
| `current_interval_total_count` | number | 5h 窗口总量 |
| `current_interval_usage_count` | number | 5h 窗口**已用**量（国内站） |
| `remains_time` | number | 5h 窗口重置倒计时（毫秒） |
| `current_weekly_total_count` | number | 周总量 |
| `current_weekly_usage_count` | number | 周**已用**量 |
| `weekly_remains_time` | number | 周重置倒计时（毫秒） |
| `base_resp.status_code` | number | `0` = 成功 |

**国内站 vs 国际站关键差异：**

| 站点 | 端点 | `usage_count` 含义 |
|------|------|-------------------|
| 国内 `api.minimaxi.com` | `/v1/token_plan/remains` | **已用**量 |
| 国际 `api.minimax.io` | `/v1/api/openplatform/coding_plan/remains` | **剩余**量 |

优先取 `model_name === "MiniMax-M*"` 的通配模型；否则取剩余百分比最低的。

## 伪代码

```typescript
const token = process.env.MINIMAX_CHINA_CODING_PLAN_API_KEY
  || readAuthJson("minimax-china-coding-plan")?.key

const res = await fetch("https://api.minimaxi.com/v1/token_plan/remains", {
  headers: { Authorization: `Bearer ${token}` },
})
const { model_remains, base_resp } = await res.json()
if (base_resp.status_code !== 0) throw new Error(base_resp.status_msg)

const model = model_remains.find((m: any) => m.model_name === "MiniMax-M*")
  || model_remains[0]
const intervalPct = (model.current_interval_usage_count / model.current_interval_total_count) * 100
const weeklyPct = (model.current_weekly_usage_count / model.current_weekly_total_count) * 100
```

---

# 4. DeepSeek

## 概述

DeepSeek 提供账户余额查询 API。**仅返回余额，不暴露配额窗口/重置周期。**

## 认证

**优先级：**

| 优先级 | 来源 | Key |
|--------|------|-----|
| 1 | 环境变量 | `DEEPSEEK_API_KEY` |
| 2 | opencode.json | `provider.deepseek.options.apiKey` |
| 3 | auth.json | `deepseek` → `.key` |

**请求头：**

```
Authorization: Bearer <token>
User-Agent: OpenCode-Quota-Toast/1.0
```

## API 详情

### 4.1 账户余额查询

```
GET https://api.deepseek.com/user/balance
```

**不需要 Query 参数。**

**响应结构：**

```json
{
  "is_available": true,
  "balance_infos": [
    {
      "currency": "CNY",
      "total_balance": "10.50",
      "granted_balance": "5.00",
      "topped_up_balance": "5.50"
    },
    {
      "currency": "USD",
      "total_balance": "1.50",
      "granted_balance": "0.00",
      "topped_up_balance": "1.50"
    }
  ]
}
```

**字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `is_available` | boolean | 账户是否有可用余额 |
| `balance_infos[].currency` | string | `CNY` 或 `USD` |
| `balance_infos[].total_balance` | string | 总余额 |
| `balance_infos[].granted_balance` | string | 赠送余额 |
| `balance_infos[].topped_up_balance` | string | 充值余额 |

**注意：** 所有余额字段为**字符串**，需 `parseFloat()`。无配额窗口概念。

## 伪代码

```typescript
const token = process.env.DEEPSEEK_API_KEY || readAuthJson("deepseek")?.key
const res = await fetch("https://api.deepseek.com/user/balance", {
  headers: { Authorization: `Bearer ${token}` },
})
const { is_available, balance_infos } = await res.json()
const cny = balance_infos.find((b: any) => b.currency === "CNY")
const usd = balance_infos.find((b: any) => b.currency === "USD")
// 展示: ¥${cny.total_balance} / $${usd.total_balance}
```

---

# 5. OpenCode Go

## 概述

OpenCode Go **没有官方 API**，需爬取 Dashboard HTML 页面，从 SolidJS SSR 水合数据中提取用量。认证方式为 Cookie，非 API Key。

## 认证

**不使用 auth.json。** 需要：

| 参数 | 环境变量 | 获取方式 |
|------|---------|---------|
| Workspace ID | `OPENCODE_GO_WORKSPACE_ID` | Dashboard URL 中提取 |
| Auth Cookie | `OPENCODE_GO_AUTH_COOKIE` | 浏览器登录后从 Cookie 复制 `auth` 值 |

也可写入 `<configDir>/opencode-quota/opencode-go.json`：

```json
{
  "workspaceId": "<string>",
  "authCookie": "<string>"
}
```

环境变量优先于配置文件。

## 爬取方式

### 5.1 Dashboard 页面

```
GET https://opencode.ai/workspace/<workspaceId>/go
```

**Headers：**

```
User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Gecko/20100101 Firefox/148.0
Accept: text/html
Cookie: auth=<authCookie>
```

### 5.2 数据提取

从 HTML 中正则匹配三个窗口：

```
rollingUsage:$R[<n>]={usagePercent:<number>,resetInSec:<number>}
weeklyUsage:$R[<n>]={usagePercent:<number>,resetInSec:<number>}
monthlyUsage:$R[<n>]={usagePercent:<number>,resetInSec:<number>}
```

| 字段 | 说明 |
|------|------|
| `usagePercent` | 已用百分比 (0-100) |
| `resetInSec` | 距重置秒数 |

`percentRemaining = 100 - usagePercent`

**注意：** Dashboard HTML 随时可能变，Cookie 会过期。不适合生产环境。

## 伪代码

```typescript
const workspaceId = process.env.OPENCODE_GO_WORKSPACE_ID
const authCookie = process.env.OPENCODE_GO_AUTH_COOKIE

const res = await fetch(`https://opencode.ai/workspace/${workspaceId}/go`, {
  headers: {
    "User-Agent": "Mozilla/5.0 ...",
    Accept: "text/html",
    Cookie: `auth=${authCookie}`,
  },
})
const html = await res.text()

const rolling = html.match(/rollingUsage:\$R\[\d+\]=\{usagePercent:(\d+),resetInSec:(\d+)\}/)
const weekly = html.match(/weeklyUsage:\$R\[\d+\]=\{usagePercent:(\d+),resetInSec:(\d+)\}/)
const monthly = html.match(/monthlyUsage:\$R\[\d+\]=\{usagePercent:(\d+),resetInSec:(\d+)\}/)
```

---

# 6. OpenRouter

## 概述

OpenRouter 提供官方 API Key 信息查询端点，返回余额、限额、日/周/月用量。

## 认证

**优先级：**

| 优先级 | 来源 | Key |
|--------|------|-----|
| 1 | 环境变量 | `OPENROUTER_API_KEY` |
| 2 | opencode.json | `provider.openrouter.options.apiKey` |
| 3 | auth.json | `openrouter` → `.key` |

**请求头：**

```
Authorization: Bearer <token>
```

## API 详情

### 6.1 API Key 信息查询

```
GET https://openrouter.ai/api/v1/key
```

**不需要 Query 参数。**

**响应结构：**

```json
{
  "data": {
    "label": "sk-or-v1-abc...123",
    "limit": 1000,
    "limit_reset": "daily",
    "limit_remaining": 750.50,
    "include_byok_in_limit": false,
    "usage": 12345.67,
    "usage_daily": 42.10,
    "usage_weekly": 230.50,
    "usage_monthly": 1200.00,
    "byok_usage": 0,
    "byok_usage_daily": 0,
    "byok_usage_weekly": 0,
    "byok_usage_monthly": 0,
    "is_free_tier": false
  }
}
```

**字段说明：**

| 字段 | 类型 | 说明 |
|------|------|------|
| `label` | string | Key 标签 |
| `limit` | number/null | 月度消费限额 USD，`null` = 无限 |
| `limit_reset` | string/null | `daily` / `weekly` / `monthly` / `null` |
| `limit_remaining` | number/null | 限额剩余 USD |
| `usage_daily` | number | 当日消费 USD |
| `usage_weekly` | number | 当周消费 USD |
| `usage_monthly` | number | 当月消费 USD |
| `is_free_tier` | boolean | 是否免费层 |

## 伪代码

```typescript
const token = process.env.OPENROUTER_API_KEY || readAuthJson("openrouter")?.key
const res = await fetch("https://openrouter.ai/api/v1/key", {
  headers: { Authorization: `Bearer ${token}` },
})
const { data } = await res.json()
const remaining = data.limit_remaining
const monthly = data.usage_monthly
```

---

# 7. OpenCode Zen

## 概述

**OpenCode Zen 目前没有公开的余额查询 API。**

- GitHub Issue [#10448](https://github.com/anomalyco/opencode/issues/10448) 提议 `GET /zen/v1/balance`，尚未实现
- 余额只能通过 Web Dashboard（https://opencode.ai/auth）查看
- 本地可用 `opencode stats` 查消费记录（不反映真实账户余额）

## 认证

环境变量 `OPENCODE_API_KEY`，或 auth.json 中 `opencode` 条目。

## 提议中的 API（未实现）

```
GET https://opencode.ai/zen/v1/balance
Authorization: Bearer <api-key>

{
  "balance": 42.50,
  "currency": "USD",
  "auto_reload": { "enabled": true, "threshold": 5.00, "amount": 20.00 }
}
```

---

# 8. OpenAI (Plus/Pro OAuth)

## 概述

OpenAI 通过 ChatGPT 后端 API 查询订阅用量。**必须使用 OAuth Token**，不支持普通 API Key。

## 认证

**仅 auth.json，无环境变量方案。**

| 来源 | Key | 类型 |
|------|-----|------|
| auth.json | `openai` 或 `codex` 或 `chatgpt` 或 `opencode` | `oauth` |

**auth.json 条目结构：**

```json
{
  "openai": {
    "type": "oauth",
    "access": "eyJhbGciOiJSUzI1NiIs...",
    "refresh": "eyJhbGciOiJSUzI1NiIs...",
    "expires": 1700000000000,
    "accountId": "acct-xxxxx"
  }
}
```

**Token 解析：**

- `.access` 是 JWT，可从中提取：
  - Email：JWT claim `https://api.openpi.com/profile.email`
  - Account ID：JWT claim `https://api.openai.com/auth.chatgpt_account_id`
- `.expires` 是 Unix 时间戳（毫秒），过期后需用 `.refresh` 刷新
- `.accountId` 可直接使用，无需解析 JWT

**请求头：**

```
Authorization: Bearer <oauth-access-token>
ChatGPT-Account-Id: <accountId>
User-Agent: OpenCode-Quota-Toast/1.0
```

## API 详情

### 8.1 用量查询

```
GET https://chatgpt.com/backend-api/wham/usage
```

**不需要 Query 参数。**

**响应结构：**

```json
{
  "plan_type": "chatgptplusplan",
  "rate_limit": {
    "limit_reached": false,
    "primary_window": {
      "used_percent": 45.0,
      "limit_window_seconds": 18000,
      "reset_after_seconds": 7200,
      "reset_at": 1700000000
    },
    "secondary_window": {
      "used_percent": 20.0,
      "limit_window_seconds": 604800,
      "reset_after_seconds": 302400,
      "reset_at": 1700400000
    }
  },
  "code_review_rate_limit": {
    "primary_window": {
      "used_percent": 10.0,
      "limit_window_seconds": 86400,
      "reset_after_seconds": 43200
    }
  },
  "credits": {
    "has_credits": true,
    "unlimited": false,
    "balance": "50.00"
  }
}
```

**字段说明：**

| 字段路径 | 类型 | 说明 |
|---------|------|------|
| `plan_type` | string | 含 `pro` → Pro，含 `plus` → Plus |
| `rate_limit.primary_window` | object | 主窗口（5h，`18000s`） |
| `rate_limit.secondary_window` | object/null | 次窗口（周，`604800s`） |
| `rate_limit.*.used_percent` | number | 已用百分比 |
| `rate_limit.*.limit_window_seconds` | number | 窗口总时长 |
| `rate_limit.*.reset_at` | number | 重置时间 Unix 秒（优先于 `reset_after_seconds`） |
| `code_review_rate_limit` | object/null | 代码审查限额 |
| `credits.balance` | string | 余额 |
| `credits.unlimited` | boolean | 是否无限 |

`percentRemaining = 100 - used_percent`

## 伪代码

```typescript
const auth = readAuthJson("openai", ["openai", "codex", "chatgpt", "opencode"])
if (auth?.type !== "oauth") throw new Error("需要 OAuth token")
if (auth.expires < Date.now()) throw new Error("Token 已过期")

const accountId = auth.accountId
  || JSON.parse(atob(auth.access.split(".")[1]))["https://api.openai.com/auth.chatgpt_account_id"]

const res = await fetch("https://chatgpt.com/backend-api/wham/usage", {
  headers: {
    Authorization: `Bearer ${auth.access}`,
    "ChatGPT-Account-Id": accountId,
  },
})
const { plan_type, rate_limit, credits } = await res.json()
const primaryRemain = 100 - rate_limit.primary_window.used_percent
const secondaryRemain = rate_limit.secondary_window
  ? 100 - rate_limit.secondary_window.used_percent
  : null
```

---

# 附录：通用 auth.json 读取函数

```typescript
import { readFileSync } from "fs"
import { homedir } from "os"
import { join } from "path"

interface AuthEntry {
  type: "api" | "oauth"
  key?: string
  access?: string
  refresh?: string
  expires?: number
  accountId?: string
}

function getAuthJsonPath(): string {
  const xdg = process.env.XDG_DATA_HOME
  const candidates = xdg
    ? [join(xdg, "opencode/auth.json")]
    : [
        join(homedir(), ".local/share/opencode/auth.json"),
        join(homedir(), "Library/Application Support/opencode/auth.json"),
      ]
  return candidates[0]
}

function readAuthJson(...keys: string[]): AuthEntry | null {
  try {
    const raw = readFileSync(getAuthJsonPath(), "utf-8")
    const auth: Record<string, AuthEntry> = JSON.parse(raw)
    for (const key of keys) {
      if (auth[key]) return auth[key]
    }
  } catch {}
  return null
}

function resolveApiKey(envVars: string[], authKeys: string[]): string | null {
  for (const v of envVars) {
    if (process.env[v]) return process.env[v]
  }
  const entry = readAuthJson(...authKeys)
  if (entry?.type === "api" && entry.key) return entry.key
  return null
}
```

**各 Provider 调用示例：**

```typescript
const GLM_TOKEN     = resolveApiKey(["ZHIPU_API_KEY", "ZAI_API_KEY"], ["zai-coding-plan", "zhipu-coding-plan"])
const KIMI_TOKEN    = resolveApiKey(["KIMI_API_KEY", "KIMI_CODE_API_KEY"], ["kimi-for-coding", "kimi-code", "kimi"])
const MINIMAX_TOKEN = resolveApiKey(["MINIMAX_CHINA_CODING_PLAN_API_KEY"], ["minimax-china-coding-plan", "minimax-cn-coding-plan"])
const DEEPSEEK_TOKEN = resolveApiKey(["DEEPSEEK_API_KEY"], ["deepseek"])
const OPENROUTER_TOKEN = resolveApiKey(["OPENROUTER_API_KEY"], ["openrouter"])
const OPENAI_AUTH   = readAuthJson("openai", "codex", "chatgpt", "opencode")
```

---

# 可实现性总结

| Provider | 纯环境变量 | 环境变量 + auth.json | 数据维度 | 难度 |
|----------|-----------|---------------------|---------|------|
| GLM Coding Plan | ✅ | ✅ | 5h Token% + 月度时长% | 低 |
| Kimi Code | ✅ | ✅ | 用量/限额 + 多窗口 | 低 |
| MiniMax CN | ✅ | ✅ | 5h + 周，按模型 | 低 |
| DeepSeek | ✅ | ✅ | 仅余额 CNY/USD | 低 |
| OpenCode Go | ✅ (Cookie) | N/A | 5h/周/月 用量% | 高（爬虫） |
| OpenRouter | ✅ | ✅ | 余额 + 日/周/月用量 | 低 |
| OpenCode Zen | ❌ | ❌ | **无 API** | - |
| OpenAI OAuth | ❌ | ✅ | 5h/周/代码审查 用量% | 中（OAuth JWT） |
