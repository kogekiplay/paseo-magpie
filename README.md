<p align="center">
  <img src="assets/icon.png" alt="Paseo Magpie plugin icon" width="96">
</p>

<h1 align="center">Magpie for Paseo</h1>

<p align="center">把 Magpie 的额度、余额和实际模型路由带到 Paseo。</p>

把 [Magpie](https://github.com/yetone/magpie) 的账号额度与余额接入 [Paseo](https://paseo.sh) 原生 **Usage / 额度** 入口，并在会话输入框附近显示实际模型路由。

图标使用 [Magpie 官方图形](https://github.com/yetone/magpie/tree/main/internal/gui/assets/icons)，原始许可见 [assets/MAGPIE-LICENSE](assets/MAGPIE-LICENSE)。

Shows Magpie account quotas in Paseo's native Usage and the current session's actual model routing in a composer pill. Supports Codex and Claude Code sessions routed through Magpie.

## 安装

需要 Paseo **0.16.0+**，守护进程和客户端均须支持原生 Usage source 插件。先在 Paseo 设置中启用插件，再执行：

```sh
paseo plugin install github:kogekiplay/paseo-magpie
```

Magpie 默认应运行在 **Paseo 守护进程所在主机**的 `http://127.0.0.1:3425`。打开全局 Usage / 额度入口即可查看各账号；手机连接同一个 Paseo 主机时也由该主机读取额度。

## 显示内容

- 每个账号独立显示，保留供应商名称、账号别名和套餐。
- 同一供应商有多个账号时，额外显示“总额度”卡片，默认将汇总窗口用于侧栏摘要；各账号明细仍可单独固定。
- 各额度窗口的使用比例、剩余比例和重置时间。
- USD、credits、requests、tokens 余额；其他货币和单位保留原始文字。
- 实际读取时间、缓存读取状态和读取异常；时间以主机本地时区显示，并附 UTC 偏移。
- 未知额度显示为未知，网关离线显示错误，账号移除后显示不可用。

额度来自 Magpie 网关的 `GET /v1/magpie/quotas`。刷新遵循 Magpie 自身的缓存规则，不会强制触发 Claude Code 的 `/usage` 或重置任何额度。

额度仍为**全局账号额度**。路由组可能跨多个账号，不将这些额度绑定到某个 Paseo 会话。

### 当前会话实际路由

Codex 和 Claude Code 会话的输入框附近按顺序显示 Magpie 最近一次实际尝试的供应商、已接收大小和模型。Paseo 原生按钮有固定宽度，因此三项分别显示在相邻入口中，接收大小不会被模型名挤掉。仅供应商入口可打开详情，大小和模型只展示信息；请求结束后整组自动隐藏：

- 请求模型、路由组、实际尝试的供应商/模型，以及上游响应声明的模型。
- 请求、路由和响应各自上报的推理强度与服务层级。
- 请求状态、HTTP 状态和请求时间。
- 多次尝试及回退记录。辅助请求单独标注，不冒充主对话请求。
- 实时接收大小，自动切换 B、KB、MB；详情同时显示距最近内容的秒数。请求中喜鹊图标显示系统加载动画；字节数变化有短促的弹簧回弹过渡，新请求直接重置。连续 5 秒没有新内容时显示“等待响应”，连续 20 秒显示“可能卡住”，收到新内容后自动恢复。

插件通过 Paseo 公共 SDK 获取当前 agent 的原生会话 ID，再读取 `GET /v1/magpie/route?session=...`，不根据目录、请求模型或其他会话的最新请求推断。服务端在读取前后校验会话身份，切换或重开会话时丢弃迟到结果。客户端在 agent 运行期间保持路由观察，空闲且没有详情挂载后取消；断线和接口错误会清除旧结果并自动重试。

当前 Magpie 的会话路由接口未直接返回接收大小。本机网关使用 `GET /v1/magpie/trace` 补充真实字节读数，严格校验同一会话、请求 ID、时间、尝试模型和状态后，仅将字节数与最近内容时间发送给客户端。trace 原文含其他请求及账号信息，插件不会转发或记录这些信息。受限密钥被拒绝时保留路由显示，并注明字节未提供；远程网关不查询本机专用的 trace。如果未来会话接口直接提供字节数则优先使用。数值表示响应字节（含协议封装），按 1024 换算；动画表示请求仍在进行，短暂没有新内容不等于失败。

会话需要经 Magpie 发出请求。没有原生会话 ID 时显示等待会话，没有近期记录时显示等待请求。网关只保留有限的近期路由，因此这里展示的是**当前会话最近一次可查请求**，不保证是正在运行的主对话轮次，也不提供历史统计。Magpie 的路由接口不返回实际账号身份。

网关需要支持 `/v1/magpie/route`。旧版本返回 404 时会提示升级。额度和路由使用同一份网关配置；远程受限密钥只能读取 Magpie 允许它查看的请求。原生会话 ID 只发送给配置的 Magpie 网关，不写入插件日志或持久化到插件文件；原始上游错误文字不发给客户端。

### 回复的实际路由

使用本机 Magpie 网关时，精确匹配的新回复下方会显示「供应商 · 模型」，点开可查看这次请求的尝试顺序和 HTTP 状态。Claude Code 直接用网关提供的响应 ID。Codex 需要在同机、同一用户下运行 Magpie 和 Paseo 守护进程，并在 Magpie 上安装 Magpie Paseo Bridge。在 Paseo 的「设置 → 插件 → Magpie」中可打开 [Magpie Paseo Bridge 安装指南](https://github.com/kogekiplay/magpie-paseo-bridge/blob/main/README.zh-CN.md#安装)。配套插件当前支持 macOS 和 Linux。没有精确关联的路由时，回复下方不显示记录。原生 ChatGPT 转发路径可能缺少关联所需的字段。

### 多账号汇总

汇总使用网关的公开额度读数，按供应商、账号类型和来源分别分组：

- 只给至少两个账号共同拥有的同类窗口生成汇总值。
- 百分比窗口只在同套餐内取平均，Pro Lite、Team 等套餐分别计算。
- 提供实际用量与上限的窗口累加两者，再计算总使用比例；同单位的独立钱包余额累加。
- 读取失败、缺失的读数和已跨重置时间的旧缓存不算成空额度或满额度。
- 重置时间为参与账号中最早的重置时间，不表示整组额度同时恢复。

从旧版升级后，已经固定的单账号窗口会保留。可以在原生 Usage 中取消这些固定项，改为固定“总额度”卡片中的窗口。

## 可选配置

默认无需配置。使用其他地址或需要密钥时，在**守护进程所在主机**创建配置文件：

- macOS / Linux：`~/.config/paseo-magpie/config.json`
- 设置了 `XDG_CONFIG_HOME` 时：`$XDG_CONFIG_HOME/paseo-magpie/config.json`
- Windows：`%APPDATA%\paseo-magpie\config.json`

```json
{
  "url": "https://your-magpie.example",
  "apiKey": "YOUR_GATEWAY_KEY",
  "timeoutMs": 15000
}
```

只需填写用到的字段。`url` 支持网关根地址或以 `/v1` 结尾的 API 地址，也支持反向代理路径前缀。超时范围为 100–15000 毫秒。

远程访问需要 Magpie 允许网络共享，并使用有权读取额度的网关密钥。受限密钥可见的账号由 Magpie 决定。插件不申请管理权限。

配置也可以通过守护进程的环境变量设置：

| 环境变量 | 用途 |
| --- | --- |
| `PASEO_MAGPIE_CONFIG` | 配置文件路径 |
| `PASEO_MAGPIE_URL` | 覆盖网关地址 |
| `PASEO_MAGPIE_API_KEY` | 覆盖网关密钥 |

配置文件每次读取额度或路由时重新读取。修改后在 Usage 中刷新即可，路由会自动重新读取；新增或移除账号时刷新额度列表。配置文件和密钥无需放进源码目录。

## 开发

Node.js 22.18+。

```sh
npm ci
npm run typecheck
npm test
paseo plugin install .
```

使用 Paseo 提供的 `@getpaseo/plugin/server/usage` 注册原生额度来源，使用 composer pill 和可取消的插件订阅显示会话路由。界面采用 React Native 组件和 Paseo 主题色。运行时依赖由 Paseo 提供，无需构建步骤。源码更新后执行 `paseo plugin reload paseo-magpie`。

测试使用合成账号与额度数据，不需要真实账号或密钥。源码和文档不包含本机账号数据。

MIT License.
