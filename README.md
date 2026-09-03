# dsh-plugin-feihualing —— 飞花令游戏插件

DeepSeek Harness 飞花令游戏插件，两种玩法：

- **🎴 浏览器即时对战（v1.1+）**：会话标题行点 🎴 打开浮层面板——内置 AI 对手出题、限时对诗、连击计分、三档难度、局制结算与本地战绩。判定在本机完成（与对话模式共用同一套规则），**不走模型回合**——AI 在后台跑任务时，随手就能开一局休闲。
- **💬 对话模式**：简易 / 古法严格双模式，游戏状态（令字、得分、已用诗句、剩余提示次数）由插件**按会话独立维护**；插件自身不向主聊天输出流写入任何内容，所有播报由模型根据工具返回值完成。

## 玩法

### 🎴 即时对战（浏览器面板）

在任意会话标题操作行点 **🎴** 打开「飞花令 · 即时对战」浮层：

- 对手先手出题（含令字的诗句），你在限时内对出**含令字的新句**（轻松 30s / 标准 20s / 困难 15s）；
- 连续答对触发**连击加分**；双方（你与对手）用过的诗句都不能再用（双边去重）；
- **连对 7 题通关**，超时 3 次惜败；简易 / 古法模式任选，古法按「令字位置 1→7 循环」推进；
- 「💡 提示」给出参考句（参考句直接跟对只得 5 分、断连击）；「再来一局」自动换新令字；
- 战绩（胜 / 负 / 连胜 / 最佳）存于本机；关闭面板不丢对局（隐藏视同暂停）；
- 面板判定与对话模式共用 `src/shared` 规则，**不占用模型上下文**。

### 关键词指令（直接对插件说）

| 指令 | 作用 |
| --- | --- |
| 开始飞花令 / 开始游戏 | 开启一局（关键词默认简易模式） |
| 结束飞花令 / 结束游戏 / 停止飞花令 | 结束对局并结算 |
| 换字 | 更换令字（得分与已用诗句保留） |
| 提示 | 消耗 1 次提示次数，给出参考诗句 |
| 认输 | 认输并结算 |
| 暂停 | 手动暂停并保存现场 |
| 继续飞花令 / 继续游戏 | 从暂停处继续 |

非指令的普通消息若**包含令字**，会被当作诗句尝试自动判定；不含令字的消息视为聊天，直接忽略。

### 判定规则

- **simple 简易**：诗句（4–48 字）任意位置包含令字即可，得分 +1；重复诗句无效。
- **ancient 古法严格**：令字必须位于本轮指定位置（第 1 字 → 第 7 字循环）；位置不符或诗句过短无效。

### 模型工具

| 工具 | 说明 |
| --- | --- |
| `feihualing_start` | 开始/重新开始对局，可选参数 `mode: simple \| ancient` |
| `feihualing_status` | 查询状态：模式、令字、得分、已用诗句、剩余提示次数、最近判定等 |
| `feihualing_stop` | 结束对局并结算 |

### 自动暂停（保存现场）

检测到 shell / 文件写入类工具调用（`bash`、`pwsh`、`shell`、`write`、`edit` 等，可配置 `autoPause` 关闭）时，游戏自动暂停，现场写入快照文件；宿主重启后同一会话可通过「继续飞花令」恢复。手动暂停同样保存现场。

## 配置

在 profile 的 `cordis.yml` 对应条目下配置（缺省值如下）：

```yaml
- id: feihualing
  name: dsh-plugin-feihualing
  config:
    enable: true        # 总开关
    maxHintCount: 3     # 每局最大提示次数（0-10 整数）
    autoPause: true     # shell/文件写入工具调用时自动暂停
```

## 安装

> 本插件是 **DSH bundle**，安装到 profile 即自动挂载（id `feihualing`），运行时零第三方依赖。需已装 `dsh` CLI（或桌面版）、Node.js ≥ 20、pnpm ≥ 10；下文 profile 以 `desktop` 为例，替换为你实际的 profile（见 `$DSH_HOME/profiles/`）。

### 从 GitHub 直接安装（推荐）

```bash
dsh plugin --profile desktop add github:zhaoxuejie/dsh-plugin-feihualing
```

- git 安装拿到的是源码，包的 `prepare` 脚本会在安装时自动执行 `pnpm run build` 生成 `lib/`，无需手动构建；
- pnpm ≥ 10 默认拒绝执行 git 依赖的 `prepare`，首次会失败：请在该 profile 目录的 `pnpm-workspace.yaml` 加入白名单后重跑上面的命令：

```yaml
allowBuilds:
  dsh-plugin-feihualing: true
```

> ⚠️ 允许构建 = 允许安装时在您机器上执行该包代码，仅对信任的源码开启；更稳妥的是固定 commit：`github:zhaoxuejie/dsh-plugin-feihualing#<sha>`。

### 克隆源码本地安装

```bash
git clone https://github.com/zhaoxuejie/dsh-plugin-feihualing.git
cd dsh-plugin-feihualing
pnpm install && pnpm run build
dsh plugin --profile desktop add .   # 在仓库根目录执行
```

### 或经 npm / tarball 安装（预构建，免白名单）

```bash
dsh plugin --profile desktop add dsh-plugin-feihualing               # 已发布 npm 时
dsh plugin --profile desktop add ./dsh-plugin-feihualing-1.1.0.tgz   # 或 pnpm pack 产物
```

> 💡 UI 说明：`dsh.client`（浏览器半边）随包分发，Web GUI 安装后**重启一次**即出现 🎴 面板按钮（client bundle 按内容 rev 刷新）。

### 验证与卸载

```bash
dsh --profile desktop --dump-config   # 应能看到 "# == dsh-plugin-feihualing" 层
dsh --profile desktop                 # 启动后：对话说「开始飞花令」可对诗；
                                      #   会话标题行会出现 🎴 按钮，打开即时对战面板

dsh plugin --profile desktop remove dsh-plugin-feihualing   # 卸载并清理快照
```

可选配置（提示次数、自动暂停等）见上方「配置」章节。

## 开发

```bash
pnpm install
pnpm typecheck   # 严格类型检查（tsc --noEmit）
pnpm test        # 引擎逻辑冒烟测试（对局引擎 23 项断言）
pnpm run build   # tsdown：lib/index.js（Host）+ lib/client.js（浏览器 UI）
```

结构：`src/index.ts` Host 半边（状态机 / 三个工具 / 事件 / 快照白名单）；`src/client/` 浏览器 UI（即时对战面板、引擎、战绩）；`src/shared/` 双半共用（判定规则、诗句库，保证对话与面板判定一致）。Host 无任何第三方运行时依赖；Client 仅依赖 DSH 自带的 `react`。

## 文件读写安全（白名单）

- 快照目录固定为 `$DSH_HOME/storages/dsh-plugin-feihualing`（`DSH_HOME` 环境变量优先，否则 `~/.dsh`）。
- 所有读写经 `assertSnapshotPath()` 校验：会话 id 仅允许 `[A-Za-z0-9._-]{1,64}`、防目录穿越、文件大小上限 64 KB、内容逐字段校验；白名单目录以外的任何路径一律拒绝。
- 插件卸载时清空全部会话内存状态并删除白名单目录内全部快照（无残留）。

## 其它说明

- Host 半边不使用定时器、无后台任务；会话之间状态完全隔离。
- 事件映射（需求名 → 本 Harness 实际事件）：`user:message → user/message`、`turn:before → turn/start`、`turn:after → turn/end`、`tool:before → tool/call`、`plugin:unload → Cordis fiber dispose（ctx.effect 清理 + 字面量事件兜底）`。
- 浏览器 UI：会话头 🎴 按钮 + 浮层（`dsh.client` platform=web，仅依赖 DSH 运行时自带 react）；面板对局为独立即时战，与本机会话的 localStorage 战绩。对话模式状态经 `feihualing_status` 返回给模型播报。
