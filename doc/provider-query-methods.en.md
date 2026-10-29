# Provider Quota Query Methods

[中文](provider-query-methods.md) | [English](provider-query-methods.en.md) | [日本語](provider-query-methods.ja.md)

This document describes the provider usage/quota query methods implemented by `opencode-statusline`. The implementation entry is `src/lib/providers.ts`, which normalizes provider-specific responses into `UsageReport` for the `/quota` dialog and quota/balance statusline fields.

The `session_cost` statusline field does not use this provider quota collector. OpenCode V2 `SessionInfo.cost` already contains provider-recorded cost; the plugin sums the session subtree directly.

## Credential Resolution

Credentials resolve in this order:

1. active credential matching the integrationID in the OpenCode V2 credential store (`context.client.credential.list()`)
2. provider-specific environment variables

OAuth providers only read OAuth tokens from the V2 credential store. The plugin no longer reads `auth.json` or supports `OPENCODE_AUTH_JSON`.

## Provider Overview

| Provider / plan | Provider IDs | Credential hints | Data shown |
| --- | --- | --- | --- |
| Z.ai coding plan | `zai`, `zai-coding-plan` | `ZAI_API_KEY`, `ZAI_CODING_PLAN_API_KEY` | 5h/daily/weekly token quota, time quota |
| Zhipu coding plan | `zhipu`, `zhipuai`, `zhipu-coding-plan`, `zhipuai-coding-plan` | `ZHIPU_API_KEY`, `ZHIPU_CODING_PLAN_API_KEY` | 5h/daily/weekly token quota, time quota |
| Kimi Code | `kimi`, `kimi-code`, `kimi-for-coding` | `KIMI_API_KEY`, `KIMI_CODE_API_KEY` | usage window, 5h window when present |
| MiniMax coding plan | `minimax`, `minimax-coding-plan` | `MINIMAX_CODING_PLAN_API_KEY`, `MINIMAX_API_KEY` | 5h quota, weekly quota |
| MiniMax CN coding plan | `minimax-cn`, `minimax-china-coding-plan`, `minimax-cn-coding-plan` | `MINIMAX_CHINA_CODING_PLAN_API_KEY` | 5h quota, weekly quota |
| Xiaomi MiMo Token Plan | `xiaomi-mimo`, `xiaomi`, `mimo`, `mimo-token-plan`, `xiaomi-token-plan*` | `XIAOMI_MIMO_SESSION_COOKIE` for usage; `XIAOMI_TOKEN_PLAN_API_KEY` / `MIMO_API_KEY` for model calls | plan/compensation/monthly credits quota, credits remaining |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` | account balance, availability |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | key label, remaining limit, usage totals |
| OpenCode Go | `opencode-go`, `opencodego` | Console integration uses built-in `usage.limits`; standalone Go integration uses only its own key / `OPENCODE_API_KEY` | 5h/weekly/monthly subscription quota |
| OpenAI / ChatGPT / Codex OAuth | `openai`, `codex`, `chatgpt` | V2 credential store OAuth entry | ChatGPT plan, 5h/weekly/monthly quota, code review quota, credits |
| OpenCode Zen | `opencode` | N/A | use built-in `/usage` for Console limits |

Provider IDs are matched case-insensitively.

## Z.ai / Zhipu Coding Plan

Z.ai and Zhipu share the same response shape. The plugin currently calls only the quota endpoint.

| Provider kind | Endpoint |
| --- | --- |
| Z.ai | `GET https://api.z.ai/api/monitor/usage/quota/limit` |
| Zhipu / BigModel | `GET https://bigmodel.cn/api/monitor/usage/quota/limit` |

Headers:

```text
Authorization: <token>
Content-Type: application/json
User-Agent: OpenCode-Statusline/0.1
```

The token is sent as-is, without a `Bearer ` prefix.

Typical response shape:

```json
{
  "data": {
    "limits": [
      {
        "type": "TOKENS_LIMIT",
        "unit": 3,
        "percentage": 45.2,
        "nextResetTime": 1760000000000
      },
      {
        "type": "TIME_LIMIT",
        "percentage": 30.1,
        "currentValue": 1800,
        "usage": 6000
      }
    ]
  }
}
```

Mapping:

| Response | Usage window |
| --- | --- |
| `type === "TOKENS_LIMIT"`, `unit === 6` | weekly quota |
| `type === "TOKENS_LIMIT"`, `unit === 4` | daily quota |
| `type === "TOKENS_LIMIT"`, `unit === 3` or first token window | 5h quota |
| `type === "TIME_LIMIT"` | monthly time quota |

The plugin uses `percentage` as used percent and `nextResetTime` as reset time when present.

## Kimi Code

Endpoint:

```text
GET https://api.kimi.com/coding/v1/usages
```

Headers:

```text
Authorization: Bearer <token>
User-Agent: OpenCode-Statusline/0.1
```

Supported response variants:

```json
{
  "data": {
    "usage": {
      "limit": 100,
      "used": 45,
      "remaining": 55,
      "name": "Kimi Code",
      "reset_at": "2026-06-01T00:00:00Z"
    },
    "limits": [
      {
        "name": "rolling",
        "detail": {
          "limit": 100,
          "used": 45,
          "remaining": 55,
          "reset_at": "2026-06-01T00:00:00Z"
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

The parser accepts both top-level `usage` and `data.usage`. It computes used count from `used`, or from `limit - remaining` when only `remaining` exists. A `limits[]` row with `window.duration === 5` and `window.timeUnit` containing `HOUR` is mapped to the 5h quota window.

## MiniMax Coding Plans

Endpoints:

```text
International: GET https://api.minimax.io/v1/api/openplatform/coding_plan/remains
China:         GET https://api.minimaxi.com/v1/token_plan/remains
```

Headers:

```text
Authorization: Bearer <token>
User-Agent: OpenCode-Statusline/0.1
```

Response shape:

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

The generic `minimax` provider uses the international endpoint; only explicit CN aliases use the China endpoint. The implementation selects the `MiniMax-M*` wildcard row first, then a row matching the current model id, then the first row. The two endpoints use opposite `*_usage_count` semantics: **international reports remaining**, **China reports used**. The plugin converts international remaining counts to used (`used = total - remaining`).

| Response fields | Usage window |
| --- | --- |
| `current_interval_usage_count` / `current_interval_total_count`, `remains_time` | 5h quota |
| `current_weekly_usage_count` / `current_weekly_total_count`, `weekly_remains_time` | weekly quota |

## Xiaomi MiMo Token Plan

Official Xiaomi docs list Token Plan API keys in `tp-xxxxx` format and OpenAI-compatible base URLs such as `https://token-plan-cn.xiaomimimo.com/v1`, `https://token-plan-sgp.xiaomimimo.com/v1`, and `https://token-plan-ams.xiaomimimo.com/v1`. Those keys are for model calls. The current usage endpoint is a console/SSO endpoint and rejects `tp-*` keys, so the plugin requires a logged-in browser cookie for usage lookup.

Endpoint:

```text
GET https://platform.xiaomimimo.com/api/v1/tokenPlan/usage
```

Headers:

```text
Cookie: <XIAOMI_MIMO_SESSION_COOKIE>
User-Agent: OpenCode-Statusline/0.1
```

Response shape:

```json
{
  "code": 0,
  "data": {
    "usage": {
      "items": [
        { "name": "plan_total_token", "used": 12000000, "limit": 60000000, "percent": 20 },
        { "name": "compensation_total_token", "used": 500000, "limit": 1000000, "percent": 50 }
      ]
    },
    "monthUsage": {
      "items": [
        { "name": "month_total_token", "used": 12500000, "limit": 61000000, "percent": 20.49 }
      ]
    }
  }
}
```

Mapping:

| Response item | Usage output |
| --- | --- |
| `usage.items[].name === "plan_total_token"` | Plan quota and `Credits remaining` balance |
| `usage.items[].name === "compensation_total_token"` | Compensation quota |
| `monthUsage.items[].name === "month_total_token"` | Monthly quota |

The usage dialog displays credit windows with a `credits` suffix. The `Provider balance` statusline field uses `Credits remaining` and renders it compactly, for example `bal 48M credits`.

## DeepSeek

Endpoint:

```text
GET https://api.deepseek.com/user/balance
```

Headers:

```text
Authorization: Bearer <token>
User-Agent: OpenCode-Statusline/0.1
```

Response shape:

```json
{
  "is_available": true,
  "balance_infos": [
    {
      "currency": "CNY",
      "total_balance": "10.50",
      "granted_balance": "5.00",
      "topped_up_balance": "5.50"
    }
  ]
}
```

DeepSeek exposes account balances, not rolling quota windows. The plugin formats each currency balance and includes granted/topped-up split rows when present.

## OpenRouter

Endpoint:

```text
GET https://openrouter.ai/api/v1/key
```

Headers:

```text
Authorization: Bearer <token>
User-Agent: OpenCode-Statusline/0.1
```

Response shape:

```json
{
  "data": {
    "label": "sk-or-v1-abc...123",
    "limit": 1000,
    "limit_remaining": 750.5,
    "limit_reset": "daily",
    "usage": 12345.67,
    "usage_daily": 42.1,
    "usage_weekly": 230.5,
    "usage_monthly": 1200,
    "byok_usage": 0,
    "is_free_tier": false
  }
}
```

The plugin shows key label, limit/remaining limit, reset label, usage totals, BYOK usage, and free-tier state when present. OpenRouter does not expose 5h/weekly subscription windows in the same sense as coding plans.

## OpenCode Go

The OpenCode V2 built-in usage service already exposes Go limits:

```text
GET /api/experimental/usage/limits
```

Only when the current provider has `integrationID === "opencode"` (bound to OpenCode Console) does the plugin call `context.client.experimental.usage.limits()` and read `data.go`:

```ts
data.go = {
  rolling: { percent, limited, resetsAt },
  weekly: { percent, limited, resetsAt },
  monthly: { percent, limited, resetsAt }
}
```

This path reuses the OpenCode Console credential and needs no extra API key.

A standalone `opencode-go` integration does not use built-in Console data; it uses its own Go API-key endpoint:

```text
GET https://opencode.ai/zen/go/v1/usage
Authorization: Bearer <token>
User-Agent: OpenCode-Statusline/0.1
```

That path only accepts an `opencode-go`/`opencodego` integration key or `OPENCODE_API_KEY`. Console OAuth/key credentials are never sent to this endpoint.

Response shape:

```json
{
  "usage": {
    "rolling": {
      "status": "ok",
      "percent": 12.5,
      "resetsAt": "2026-08-19T01:00:00.000Z"
    },
    "weekly": {
      "status": "ok",
      "percent": 30,
      "resetsAt": "2026-08-24T00:00:00.000Z"
    },
    "monthly": {
      "status": "ok",
      "percent": 45,
      "resetsAt": "2026-09-18T00:00:00.000Z"
    }
  }
}
```

`usage.rolling`, `usage.weekly`, and `usage.monthly` map to the 5h, weekly, and monthly quota windows. `percent` is the used percentage and `resetsAt` is an absolute ISO 8601 reset time; `status` can be `ok` or `rate-limited`. This query no longer needs a workspace ID or browser cookie.

## OpenAI / ChatGPT / Codex OAuth

Endpoint:

```text
GET https://chatgpt.com/backend-api/wham/usage
```

Credentials:

| Source | Keys |
| --- | --- |
| OpenCode V2 credential store OAuth entry | `openai`, `codex`, `chatgpt` |

Headers:

```text
Authorization: Bearer <oauth-access-token>
ChatGPT-Account-Id: <accountId>
User-Agent: OpenCode-Statusline/0.1
```

The plugin reads `access`, `expires`, and optional `metadata.accountID` from the V2 credential. If `accountID` is absent, it attempts to decode the JWT claim `https://api.openai.com/auth.chatgpt_account_id`. OpenCode Console (`opencode`) OAuth credentials are deliberately excluded.

Response shape:

```json
{
  "plan_type": "chatgptplusplan",
  "rate_limit": {
    "limit_reached": false,
    "primary_window": {
      "used_percent": 45,
      "limit_window_seconds": 18000,
      "reset_after_seconds": 7200,
      "reset_at": 1700000000
    },
    "secondary_window": {
      "used_percent": 20,
      "limit_window_seconds": 604800,
      "reset_after_seconds": 302400,
      "reset_at": 1700400000
    }
  },
  "code_review_rate_limit": {
    "primary_window": {
      "used_percent": 10,
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

Mapping:

| Response | Usage window / item |
| --- | --- |
| `rate_limit.primary_window` / `secondary_window` | classified by `limit_window_seconds`: 18000 = 5h, 604800 = weekly, 2628000 = monthly |
| `code_review_rate_limit.primary_window` | code review quota |
| `credits` | credits balance / unlimited state |

The plugin does not refresh OAuth tokens. If the access token in the credential store is already expired, the ChatGPT endpoint returns 401; send one OpenAI request in OpenCode so the host can refresh the credential.

## OpenCode Zen

Provider id `opencode` Console workspace/model limits are shown by the built-in `/usage`. The plugin `/quota` points users to `/usage` instead of claiming Zen has no usage API.

## Normalization Rules

All collectors normalize provider-specific data into:

| Field | Meaning |
| --- | --- |
| `windows[]` | quota windows such as 5h, daily, weekly, monthly, code review |
| `balances[]` | account balance-like rows used by `/quota` and the `Provider balance` statusline field |
| `items[]` | miscellaneous labels such as key label, model row, free tier, plan details |
| `usedPercent` / `remainingPercent` | clamped to `0..100` |
| `resetAtMs` / `resetAfterMs` | used by UI formatting to show reset time |

Absolute reset timestamps are rendered by `/quota` in local time with fixed-width `YYYY-MM-DD HH:mm:ss` fields. Relative reset durations still use compact duration text.

Quota collection is cached for 30 seconds per provider/model kind, with stale results kept for 10 minutes for statusline fallback. `/quota` forces a fresh read and updates the cache; statusline quota/balance fields use cached rows first, share concurrent in-flight refreshes, and use stale data when a refresh fails.
