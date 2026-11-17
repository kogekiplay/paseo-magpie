# Magpie Usage for Paseo

把 [Magpie](https://github.com/yetone/magpie) 的账号额度与余额接入 [Paseo](https://paseo.sh) 原生 **Usage / 额度** 入口。

Shows Magpie account quotas and balances in Paseo's native Usage. Server-only; no additional sidebar or management screen.

## 安装

需要 Paseo **0.16.0+**，守护进程和客户端均须支持原生 Usage source 插件。先在 Paseo 设置中启用插件，再执行：

```sh
paseo plugin install github:kogekiplay/paseo-magpie
```

Magpie 默认应运行在 **Paseo 守护进程所在主机**的 `http://127.0.0.1:3425`。打开全局 Usage / 额度入口即可查看各账号；手机连接同一个 Paseo 主机时也由该主机读取额度。

## 显示内容

- 每个账号独立显示，保留供应商名称、账号别名和套餐。
- 各额度窗口的使用比例、剩余比例和重置时间。
- USD、credits、requests、tokens 余额；其他货币和单位保留原始文字。
- 实际读取时间、缓存读取状态和读取异常。
- 未知额度显示为未知，网关离线显示错误，账号移除后显示不可用。

额度来自 Magpie 网关的 `GET /v1/magpie/quotas`。刷新遵循 Magpie 自身的缓存规则，不会强制触发 Claude Code 的 `/usage` 或重置任何额度。

第一版仅提供**全局账号额度**。路由组可能跨多个账号，尚不将这些额度绑定到某个 Paseo 会话。

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

配置文件每次读取额度时重新读取。修改后在 Usage 中刷新即可；新增或移除账号时刷新额度列表。配置文件和密钥无需放进源码目录。

## 开发

Node.js 22.18+。

```sh
npm ci
npm run typecheck
npm test
paseo plugin install .
```

使用 Paseo 提供的 `@getpaseo/plugin/server/usage` 注册原生额度来源。运行时依赖由 Paseo 提供，无需构建步骤。源码更新后执行 `paseo plugin reload paseo-magpie`。

测试使用合成账号与额度数据，不需要真实账号或密钥。源码和文档不包含本机账号数据。

MIT License.
