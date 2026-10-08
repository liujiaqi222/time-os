# 开始 / 暂停延迟实测

2026-10-07，本机 Next.js 开发服务连接 `.env.local` 指定的真实 Neon
新加坡实例，使用该实例的临时隔离 schema。没有使用 Docker 数据库，也没有
修改业务 schema 中的用户记录。以下数字不是线上 Vercel 的响应时间。

## 网络基线

- 新连接的首次 `SELECT 1`：4019ms，包含连接建立。
- 同一连接连续四次 `SELECT 1`：474、486、482、484ms。
- Neon 内部 `EXPLAIN ANALYZE SELECT 1`：规划 0.019ms，执行 0.021ms。

因此简单查询的本地等待主要来自数据库往返，不能将客户端观测到的数百
毫秒解释成 PostgreSQL 执行简单 SQL 花费了数百毫秒。

## 按钮链路

基线已经包含独立 start/transition 接口以及单条计时 SQL。
浏览器实点按钮，等待响应并等待暂停 / 继续按钮出现；每次记录接口的
`Server-Timing`，鉴权和业务操作分别计时。

| 项目 | 基线 | 最终优化 |
| --- | --- | --- |
| 热启动（两次） | 1897 / 2142ms | 518 / 565ms |
| 暂停（三次） | 2038 / 1888 / 2068ms | 658 / 490 / 569ms |
| 鉴权 | 1340–1552ms | 3.2–20.0ms |
| 计时操作 | 432–521ms | 431–529ms |

首次开始的测试程序计时分别为 5179ms 和 4842ms，包含等待页面 / 按钮
就绪。补充追踪在按钮上捕获真实浏览器 click 事件，得到更准确的分解：

| 操作 | 测试程序计时 | 实际 click 到界面切换 | 请求到首字节 | 鉴权 | 业务操作 |
| --- | --- | --- | --- | --- | --- |
| 首次开始 | 5276ms | 932ms | 800ms | 22.0ms | 494.3ms |
| 第一次暂停 | 642ms | 610ms | 599ms | 3.8ms | 442.5ms |
| 第二次开始 | 564ms | 506ms | 488ms | 2.6ms | 482.4ms |
| 第二次暂停 | 555ms | 529ms | 518ms | 3.4ms | 509.2ms |
| 第三次开始 | 583ms | 534ms | 518ms | 2.5ms | 511.7ms |
| 第三次暂停 | 554ms | 523ms | 512ms | 2.9ms | 502.1ms |

因此不能将首次测试程序观测到的约 5 秒归因于点击后的 SQL 或接口等待。
真实首次 click 约 0.93 秒，后续 click 约 0.51–0.61 秒。首次请求到首字节
仍比接口内鉴权和业务操作多约 284ms；没有对这部分框架开销进一步归因。

## 原因与改动

1. `getSession` 未配置 cookie cache，重复读取会话和用户。
2. JWT 插件的默认 `/get-session` after hook 每次查签名密钥并生成
   `set-auth-jwt` 响应头，即便会话缓存命中。网页没有消费这个响应头。
3. 开启 Better Auth 原生 JWE 会话 cookie 缓存，最长 30 秒。
4. 设置 `jwt({ disableSettingJwtHeader: true })`，保留显式 token、JWKS
   和 OAuth/MCP 签名能力，停止普通 Web 鉴权附带的密钥查询。

本浏览器退出登录立即清除缓存；其他设备撤销的会话最多延迟 30 秒被
已有缓存感知。未延长登录会话的数据库过期时间。

## 重测

```sh
TIMEOS_LATENCY_LABEL=trace pnpm test:e2e tests/e2e/timer-latency.spec.ts
```

该命令读取当前 Neon URL，创建并最终删除临时测试 schema。原始样本保存
在 `.test-data/timer-latency-{baseline,optimized,final,trace}.json`。
测试同时检查三次开始 / 暂停 / 结束成功，以及退出后开始接口立即拒绝
未登录请求；补充追踪还验证显式 JWT 签名和 JWKS 验签仍可用。基线、
中间优化、最终优化和补充追踪四轮测试均通过，临时 schema 已由 runner 删除。

类型检查、相关代码 lint、笔记自动保存与番茄钟自动结束单测通过。
部署区域配置已经为 `sin1`，本次未更改部署设置或部署线上版本。

## 第二轮：缓存失效后的鉴权

在同一 Neon 实例中，每次开始前清除浏览器的 `session_data` 缓存 cookie，
保留登录会话 cookie，测量必须回源数据库的路径。

| 项目 | 合并查询前 | 合并查询后 |
| --- | --- | --- |
| 未命中缓存的鉴权（三次） | 983 / 954 / 999ms | 502 / 516 / 468ms |
| 后续两次实际开始 click | 1477 / 1545ms | 1128 / 962ms |
| 后续两次实际暂停 click（缓存命中） | 506 / 539ms | 514 / 509ms |

新增 Drizzle 的 user/session/account 关系，并启用当前 Better Auth 版本的
`advanced.database.joins`。会话和用户合并读取；密码登录的用户和账号查询
也可走原生关联查询。无需数据库迁移，未修改 30 秒缓存期限或登录撤销规则。

两轮浏览器测试均通过，合并后的测试还覆盖退出后重新密码登录，以及
`get-session?disableCookieCache=true` 的回源读取。类型检查和相关 lint 通过。

```sh
TIMEOS_LATENCY_FRESH=1 TIMEOS_LATENCY_LABEL=uncached-after pnpm test:e2e tests/e2e/timer-latency.spec.ts
```

原始样本为 `.test-data/timer-latency-uncached-{before,after}.json`。

另对真实 Neon 的 `SELECT 1` 比较 TCP 和 Neon HTTP 通道：复用连接后的
TCP 为 425 / 451 / 433 / 452ms，HTTP 为 478 / 482 / 482 / 479ms。
因此没有引入 HTTP 驱动或双通道逻辑。该比较不使用临时业务写入。
