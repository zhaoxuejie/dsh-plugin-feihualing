# dsh-plugin-feihualing —— 飞花令游戏插件

DeepSeek Harness 飞花令游戏插件：**简易 / 古法严格**双模式，游戏状态（令字、得分、已使用诗句、剩余提示次数）由插件**按会话独立维护**；插件自身不向主聊天输出流写入任何内容，所有播报由模型根据工具返回值完成。

## 玩法

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

> 本插件是一个 **DSH bundle**：`package.json` 的 `dsh.bundle.patch` 指向 `cordis.patch.yml` 的 `- insert:` 条目（id `feihualing`）。安装到某个 **profile** 后，`dsh plugin add` 会自动把包链接进该 profile 的 `node_modules`，并把 `dsh-plugin-feihualing` 追加到该 profile 的 `dsh.profile.bundles` 列表。
>
> 运行时**没有任何第三方依赖**：仅用到 Harness 自带的原生包 `@deepseek-ai/dsh-tools`（可选 peer），profile 通常已内置，无需额外安装。

### 环境要求

- 已安装 DeepSeek Harness（`dsh` CLI 或桌面版），可正常以 profile 启动；
- Node.js ≥ 20、pnpm ≥ 10（`dsh plugin` 底层即向 profile 目录转发 pnpm 命令）。

下文以 profile 名 `desktop` 为例，请替换为您实际使用的 profile（可用 `dsh plugin --help` 查看，或直接看 `$DSH_HOME/profiles/` 下的目录名）。

### 方式一：从 GitHub 直接安装（最省事，无需克隆）

在任意目录执行：

```bash
dsh plugin --profile desktop add github:<您的 GitHub 用户名>/dsh-plugin-feihualing
```

首次执行会自动初始化该 profile（引入 `@deepseek-ai/dsh-base` 作为首个 bundle）。**git 安装有以下两点须知：**

1. **安装时自动构建**：从 git 安装拿到的是**源码**而非构建产物。本包通过 `prepare` 脚本（内部执行 `pnpm run build`，用 tsc 生成 `lib/`）在安装阶段自动构建，无需手动干预。
2. **pnpm ≥ 10 构建白名单**：出于安全，pnpm ≥ 10 默认拒绝执行 git 依赖的 `prepare` 脚本，首次 `add` 会失败并提示类似 `… has an unrecognized or not allowed build script`。请按提示把包键加入**该 profile 目录**下的 `pnpm-workspace.yaml`：

   ```yaml
   allowBuilds:
     dsh-plugin-feihualing: true
   ```

   保存后重新执行上面的 `add` 命令即可完成安装。

   ⚠️ **安全提示**：允许构建 = 允许安装时在您的机器上执行该包的代码，请只对您信任的源码开启。更稳妥的做法是用 commit 固定版本，防止上游后续推送悄悄改变安装时执行的代码：

   ```bash
   dsh plugin --profile desktop add github:<您的 GitHub 用户名>/dsh-plugin-feihualing#<commit-sha>
   ```

### 方式二：克隆源码后本地安装（适合二次开发）

```bash
git clone https://github.com/<您的 GitHub 用户名>/dsh-plugin-feihualing.git
cd dsh-plugin-feihualing
pnpm install
pnpm run build              # 生成 lib/（tsc 构建产物，已被 .gitignore 忽略，需本地生成）
dsh plugin --profile desktop add .   # 在仓库根目录内执行
```

在仓库目录内执行 `dsh plugin add .` 时，pnpm 会以 `link:` 形式把当前目录链接进 profile 的 `node_modules` 并追加 bundle 层，改动源码后重新 `pnpm run build` 即可热生效。

### 方式三：npm 包 / tarball（预构建分发，无需构建白名单）

```bash
# 若已发布到 npm registry：
dsh plugin --profile desktop add dsh-plugin-feihualing

# 或使用作者分发的 tarball（pnpm pack 产物）：
dsh plugin --profile desktop add ./dsh-plugin-feihualing-1.0.0.tgz
```

这两种形式分发的是**已构建产物**，安装时不需要任何构建许可，是最省心的分发渠道。

### 验证安装

```bash
# 查看最终组合配置：应能看到 "# == dsh-plugin-feihualing" 一层的 insert 行（id: feihualing）
dsh --profile desktop --dump-config

# 启动 Harness：
dsh --profile desktop
```

启动后在新会话中直接对模型说「开始飞花令」即可开局；`feihualing_start` / `feihualing_status` / `feihualing_stop` 三个工具会随插件自动注入。若无响应，请确认 profile 中该行 `enable` 配置为 `true`（默认 `true`），并检查 `dsh --profile desktop --dump-config` 输出里确实存在该行。

### 卸载

```bash
dsh plugin --profile desktop remove dsh-plugin-feihualing
```

该命令会同时移除依赖与挂载层；插件卸载时也会清空全部会话内存状态并删除快照目录（见「文件读写安全（白名单）」）。

安装后的可选配置（提示次数、自动暂停等）请见上方「配置」章节。

## 文件读写安全（白名单）

- 快照目录固定为 `$DSH_HOME/storages/dsh-plugin-feihualing`（`DSH_HOME` 环境变量优先，否则 `~/.dsh`）。
- 所有读写经 `assertSnapshotPath()` 校验：会话 id 仅允许 `[A-Za-z0-9._-]{1,64}`、防目录穿越、文件大小上限 64 KB、内容逐字段校验；白名单目录以外的任何路径一律拒绝。
- 插件卸载时清空全部会话内存状态并删除白名单目录内全部快照（无残留）。

## 其它说明

- 不使用定时器、无后台任务；会话之间状态完全隔离。
- 事件映射（需求名 → 本 Harness 实际事件）：`user:message → user/message`、`turn:before → turn/start`、`turn:after → turn/end`、`tool:before → tool/call`、`plugin:unload → Cordis fiber dispose（ctx.effect 清理 + 字面量事件兜底）`。
- 不做侧边 UI 面板（按需求仅工具与事件逻辑）；游戏状态经 `feihualing_status` 返回给模型播报。
