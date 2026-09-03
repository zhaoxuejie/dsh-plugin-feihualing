/**
 * ============================================================
 * dsh-plugin-feihualing —— 飞花令游戏插件（DeepSeek Harness / Cordis）
 * ============================================================
 *
 * 功能总览
 *  1. 游戏模式：simple（简易，诗句任意位置包含令字即可）、
 *     ancient（古法严格，令字必须出现在本轮指定位置，按第 1 字到第 7 字循环）。
 *  2. 关键词指令（真实用户消息中识别）：开始飞花令、结束飞花令、换字、提示、
 *     认输、暂停、继续飞花令。
 *  3. 每个会话独立的内存游戏状态：令字、得分、usedPoems（已使用诗句集合）、
 *     剩余提示次数等；会话之间互不共享，插件卸载时全部清空。
 *  4. 自动暂停：监听工具调用事件，检测到 shell / 文件写入类工具（bash、pwsh、
 *     write、edit 等）调用时自动暂停游戏并把现场快照写入白名单目录。
 *  5. 注册 3 个模型工具：feihualing_start、feihualing_status、feihualing_stop。
 *     插件自身不向主聊天流输出任何内容——游戏播报由模型根据工具返回值完成，
 *     从而不污染主聊天输出流（框架规则 7）。
 *  6. 配置项：enable（总开关）、maxHintCount（最大提示次数）、autoPause（自动暂停开关）。
 *
 * Harness 事件映射（需求事件名 → 本 Harness 实际事件）
 *   user:message   → 会话事件 user/message（仅处理 source.kind === 'user' 的真实输入）
 *   turn:before    → 会话事件 turn/start
 *   turn:after     → 会话事件 turn/end
 *   tool:before    → 会话事件 tool/call（工具调用落盘，执行前可见）
 *   plugin:unload  → Cordis fiber dispose：用 ctx.effect 清理函数实现（同时保留
 *                    字面量 'plugin:unload' 监听作为兼容兜底）
 *
 * 文件读写安全
 *   快照根目录固定为 $DSH_HOME/storages/dsh-plugin-feihualing（白名单）。
 *   所有读写先经过 assertSnapshotPath() 校验：会话 id 仅允许
 *   [A-Za-z0-9._-]{1,64}、路径拼接后必须仍位于白名单根目录内（防目录穿越）、
 *   快照文件大小上限 64KB、内容逐字段校验。
 *
 * 约束（Host 半边）
 *   Host 不使用定时器、无后台任务、不引入任何第三方 npm 运行时依赖
 *   （唯一运行时 import 是 Harness 原生包 @deepseek-ai/dsh-tools）；
 *   诗句库与判定规则抽到 src/shared（Host 与浏览器 Client 共用纯模块，
 *   保证“对话判定”与“面板即时判定”规则完全一致）。
 *   浏览器 UI 半边见 src/client：内置对手即时对战，不走模型回合。
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {
  judgePoemAttempt, MAX_ANCIENT_POSITION, MAX_LINE_CHARS, MIN_LINE_CHARS, normalizeLine,
} from './shared/rules.ts'
import type { GameMode } from './shared/rules.ts'
import { LINGZI_POOL, POEM_BANK } from './shared/poems.ts'

/** 插件在 Loader 中的显示名。 */
export const name = 'feihualing'

/** 依赖注入：等待 Harness 的 tools 服务就绪后再加载本插件。 */
export const inject = ['tools']

// ============================================================
// TS 接口定义（需求 9：输出 TS 类型 interface 定义）
// ============================================================

/** 游戏模式：simple 简易 / ancient 古法严格（类型定义见 shared/rules.ts）。 */
export type { GameMode } from './shared/rules.ts'

/** 游戏阶段：idle 无对局 / running 进行中 / paused 已暂停 / finished 已结束。 */
export type GamePhase = 'idle' | 'running' | 'paused' | 'finished'

/** 插件配置（与 cordis.yml 的 config schema 一一对应）。 */
export interface FeihualingConfig {
  /** 总开关；false 时插件不注册任何逻辑。 */
  enable: boolean
  /** 每局最大提示次数（剩余提示次数的初始值），0-10 的整数。 */
  maxHintCount: number
  /** 自动暂停开关；检测到 shell/文件写入类工具调用时自动暂停并保存现场。 */
  autoPause: boolean
}

/** 单个会话的飞花令游戏状态（会话隔离的最小业务单元）。 */
export interface GameState {
  /** 所属会话 id（状态与快照都以它为键）。 */
  sessionId: string
  /** 当前阶段。 */
  phase: GamePhase
  /** 游戏模式。 */
  mode: GameMode
  /** 当前令字（单个汉字）。 */
  lingzi: string
  /** 得分（每句有效诗句 +1）。 */
  score: number
  /** 总尝试次数（含无效尝试，供统计展示）。 */
  attempts: number
  /** 已使用诗句集合（展示形式，保留原文；去重基于 usedNormalized）。 */
  usedPoems: string[]
  /** 已使用诗句的规范化文本（用于去重判定，与 usedPoems 平行索引）。 */
  usedNormalized: string[]
  /** 剩余提示次数。 */
  hintsLeft: number
  /** 古法模式当前要求的令字位置（1 起，1-7 循环）。 */
  requiredPosition: number
  /** 暂停原因；未暂停时为空字符串。 */
  pausedReason: string
  /** 最近一次事件/判定描述（模型经 status 工具读取后播报）。 */
  lastEvent: string
  /** 开局时间戳（毫秒）。 */
  startedAt: number
  /** 最近更新时间戳（毫秒）。 */
  updatedAt: number
}

/** 磁盘快照文件格式（v1，字段校验见 validateSnapshot）。 */
export interface SnapshotFile {
  /** 快照格式版本，当前恒为 1。 */
  version: 1
  /** 写入方插件标识。 */
  plugin: 'dsh-plugin-feihualing'
  /** 所属会话 id。 */
  sessionId: string
  /** 保存时间戳（毫秒）。 */
  savedAt: number
  /** 游戏状态现场。 */
  state: GameState
}

/** 对局进行中的阶段（start 工具返回值的 phase 取值，不含 idle）。 */
export type ActivePhase = 'running' | 'paused' | 'finished'

/** feihualing_start 工具返回值。 */
export interface StartResult {
  /** 是否本次调用实际开启了对局（已在进行中时为 false）。 */
  started: boolean
  phase: ActivePhase
  mode: GameMode
  lingzi: string
  score: number
  hintsLeft: number
  /** 面向模型的播报文案。 */
  message: string
}

/** feihualing_status 工具返回值（可选字段缺省表示不适用/无，与工具 JSON Schema 对齐）。 */
export interface StatusResult {
  phase: GamePhase
  mode?: GameMode
  lingzi?: string
  score: number
  attempts: number
  /** 已使用诗句列表（快照副本，防止外部修改内部状态）。 */
  usedPoems: string[]
  hintsLeft: number
  /** 古法模式要求的令字位置；非古法或 idle 时缺省。 */
  requiredPosition?: number
  pausedReason?: string
  lastEvent: string
  /** 当前会话最近的轮次号（来自 turn/start、turn/end 事件）。 */
  turn: number
}

/** feihualing_stop 工具返回值。 */
export interface StopResult {
  stopped: boolean
  finalScore: number
  usedCount: number
  message: string
}

/** 本插件消费的 Harness Context 最小子集（严格 TS 类型）。 */
export interface Context {
  /** 注册事件监听，返回注销函数；随插件 fiber 卸载自动注销。 */
  on(eventName: string, listener: (...args: any[]) => unknown): () => void
  /** 注册卸载清理：execute() 返回的 disposer 在插件卸载时执行。 */
  effect(execute: () => (() => void) | void, label?: string): void
  /** Harness 工具注册表（tools 服务，由 inject: ['tools'] 保证可用）。 */
  tools: { register(definition: ToolDefinition): void }
  /** 可选日志器；缺失时退回 console。 */
  logger?: {
    info(...args: unknown[]): void
    warn(...args: unknown[]): void
    error(...args: unknown[]): void
  }
}

/** session/event 事件负载中的 Session 最小形状。 */
interface SessionLike {
  id?: unknown
}

/** session/event 事件负载中的事件最小形状。 */
interface SessionEventLike {
  type?: unknown
  data?: unknown
}

// ============================================================
// 模块级常量（纯数据，无任何状态与副作用）
// ============================================================

const PLUGIN_ID = 'dsh-plugin-feihualing'

/** 快照格式版本。 */
const SNAPSHOT_VERSION = 1

/** 快照文件大小上限（字节），防止恶意/损坏文件拖垮读取。 */
const MAX_SNAPSHOT_BYTES = 64 * 1024

/** 诗句库与规则常量定义见 src/shared（Host/Client 共用，保证规则一致）。 */

/**
 * 关键词指令表（按顺序匹配，命中即停止）。
 * 说明：对“规范化后”的文本做包含匹配；每个关键词测试相互独立，
 * 因此“结束飞花令”不会被“开始飞花令”误命中。
 */
type CommandAction = 'start' | 'stop' | 'resume' | 'pause' | 'surrender' | 'swap' | 'hint'

const KEYWORDS: ReadonlyArray<{ action: CommandAction; test: (normalized: string) => boolean }> = [
  { action: 'stop', test: (t) => t.includes('结束飞花令') || t.includes('结束游戏') || t.includes('停止飞花令') },
  { action: 'start', test: (t) => t.includes('开始飞花令') || t.includes('开始游戏') },
  { action: 'resume', test: (t) => t.includes('继续飞花令') || t.includes('继续游戏') },
  { action: 'pause', test: (t) => t.includes('暂停') },
  { action: 'surrender', test: (t) => t.includes('认输') },
  { action: 'swap', test: (t) => t.includes('换字') },
  { action: 'hint', test: (t) => t.includes('提示') },
]

/**
 * 危险工具名集合（自动暂停触发条件）：
 * shell 类（bash/pwsh/shell 等）与文件写入类（write/edit/file_write）。
 * 工具名先剥掉 "tool:" 前缀并转小写再匹配；本插件自己的 feihualing_* 工具除外。
 */
const DANGEROUS_TOOL_NAMES: ReadonlySet<string> = new Set([
  'bash', 'shell', 'sh', 'zsh', 'cmd', 'pwsh', 'powershell', 'subprocess', 'terminal',
  'write', 'edit', 'file_write',
])

// ============================================================
// 模块级纯函数（无状态、无副作用；文本规则函数见 shared/rules.ts）
// ============================================================

/**
 * 从 user/message 事件的 content 中提取纯文本。
 * 兼容字符串、文本块（{ type: 'text'|'input_text', text }）等形态。
 */
function extractText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let out = ''
  for (const part of content) {
    if (typeof part === 'string') {
      out += part
    } else if (part !== null && typeof part === 'object') {
      const block = part as { text?: unknown }
      if (typeof block.text === 'string') out += block.text
    }
  }
  return out
}

/** 归一化工具名：去掉 "tool:" 前缀并转小写。 */
function normalizeToolName(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/^tool:/, '').toLowerCase()
}

/** 统一错误信息提取（catch 变量在 strict 模式下为 unknown）。 */
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ============================================================
// 插件入口（所有状态与业务逻辑都在 apply 内部，无模块级可变状态）
// ============================================================
export function apply(ctx: Context, rawConfig?: Partial<FeihualingConfig>): void {
  // ---------- 1. 配置解析与严格校验（非法配置直接抛错拒绝加载） ----------
  const config = resolveConfig(rawConfig)

  /** 统一日志出口：优先 Harness logger，缺失时退回 console。 */
  const log = (level: 'info' | 'warn' | 'error', ...args: unknown[]): void => {
    try {
      const target = ctx.logger ?? console
      target[level](...args)
    } catch {
      /* 日志失败不影响游戏逻辑 */
    }
  }

  // 总开关关闭：不注册任何事件监听与工具，插件整体空转。
  if (!config.enable) {
    log('info', `[${PLUGIN_ID}] enable=false，插件未启用`)
    return
  }

  // ---------- 2. 会话隔离的游戏状态表（仅存在于本 apply 闭包内） ----------
  // 每个会话（session.id）一份独立 GameState；卸载时全部清空（见 cleanup）。
  const games = new Map<string, GameState>()

  /** 各会话最近轮次号（来自 turn/start、turn/end 事件，用于状态展示）。 */
  const lastTurns = new Map<string, number>()

  // ---------- 3. 快照白名单根目录：$DSH_HOME/storages/dsh-plugin-feihualing ----------
  const dataDir = resolveDataDir()

  /**
   * 快照路径白名单校验（安全关键代码）。
   * 校验三步：
   *  1) 会话 id 必须是严格文件名形式（[A-Za-z0-9._-]{1,64}），杜绝 ../ 等穿越字符；
   *  2) path.resolve 后的最终路径必须与“白名单根目录 + 固定文件名”的拼接结果
   *     完全一致（等价于拒绝任何穿越）；
   *  3) 最终路径必须位于白名单根目录之内（双保险前缀校验）。
   * @throws 路径非法时抛出异常，调用方负责拦截。
   */
  function assertSnapshotPath(sessionId: string): string {
    if (!/^[A-Za-z0-9._-]{1,64}$/.test(sessionId)) {
      throw new Error(`非法会话 id（仅允许 [A-Za-z0-9._-]{1,64}）: ${JSON.stringify(sessionId)}`)
    }
    const root = path.resolve(dataDir)
    const fileName = `snapshot-${sessionId}.json`
    const target = path.resolve(root, fileName)
    if (target !== path.join(root, fileName)) {
      throw new Error(`快照路径越界被拒绝: ${target}`)
    }
    if (!target.startsWith(root + path.sep)) {
      throw new Error(`快照路径不在白名单目录内: ${target}`)
    }
    return target
  }

  /** 保存现场：把会话游戏状态写入白名单目录内的快照文件（同步、原子性足够）。 */
  function saveSnapshot(sessionId: string, state: GameState): void {
    try {
      const file = assertSnapshotPath(sessionId)
      fs.mkdirSync(dataDir, { recursive: true })
      const snapshot: SnapshotFile = {
        version: SNAPSHOT_VERSION,
        plugin: PLUGIN_ID,
        sessionId,
        savedAt: Date.now(),
        state: { ...state, usedPoems: [...state.usedPoems], usedNormalized: [...state.usedNormalized] },
      }
      fs.writeFileSync(file, JSON.stringify(snapshot, null, 2), 'utf8')
      log('info', `[${PLUGIN_ID}] 会话 ${sessionId}: 现场已保存到 ${file}`)
    } catch (error) {
      log('warn', `[${PLUGIN_ID}] 会话 ${sessionId}: 保存现场失败: ${errorMessage(error)}`)
    }
  }

  /** 删除指定会话的快照文件（对局结束/认输/开局后调用；不存在则忽略）。 */
  function deleteSnapshot(sessionId: string): void {
    try {
      fs.unlinkSync(assertSnapshotPath(sessionId))
    } catch {
      /* 文件不存在等一律忽略 */
    }
  }

  /**
   * 从快照恢复现场（例如宿主重启后同一会话继续）。
   * 文件缺失、超限、JSON 损坏或字段校验失败时返回 undefined。
   */
  function restoreSnapshot(sessionId: string): GameState | undefined {
    let file: string
    try {
      file = assertSnapshotPath(sessionId)
    } catch {
      return undefined
    }
    try {
      const stat = fs.statSync(file)
      if (stat.size > MAX_SNAPSHOT_BYTES) {
        log('warn', `[${PLUGIN_ID}] 会话 ${sessionId}: 快照超过大小上限，已忽略`)
        return undefined
      }
      const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
      const snapshot = validateSnapshot(parsed, sessionId)
      if (snapshot === null) return undefined
      log('info', `[${PLUGIN_ID}] 会话 ${sessionId}: 已从快照恢复现场（${snapshot.state.phase}）`)
      return snapshot.state
    } catch {
      return undefined
    }
  }

  /** 读取会话现场：内存优先，缺失时尝试从快照恢复（恢复后写入内存表）。 */
  function ensureState(sessionId: string): GameState | undefined {
    const existing = games.get(sessionId)
    if (existing) return existing
    const restored = restoreSnapshot(sessionId)
    if (restored) games.set(sessionId, restored)
    return restored
  }

  // ---------- 4. 游戏引擎（纯内存状态机） ----------

  /** 随机抽取令字；与 exclude 相同时重抽（最多重试几次，不用定时器）。 */
  function pickLingzi(exclude: string): string {
    for (let attempt = 0; attempt < 8; attempt++) {
      const lingzi = LINGZI_POOL[Math.floor(Math.random() * LINGZI_POOL.length)]
      if (lingzi !== exclude) return lingzi
    }
    return LINGZI_POOL[0]
  }

  /** 创建一局新游戏。 */
  function createGame(sessionId: string, mode: GameMode): GameState {
    const lingzi = pickLingzi('')
    const modeText = mode === 'ancient' ? '古法严格' : '简易'
    return {
      sessionId,
      phase: 'running',
      mode,
      lingzi,
      score: 0,
      attempts: 0,
      usedPoems: [],
      usedNormalized: [],
      hintsLeft: config.maxHintCount,
      requiredPosition: 1,
      pausedReason: '',
      lastEvent: `飞花令开始！模式：${modeText}，令字「${lingzi}」，剩余提示 ${config.maxHintCount} 次` + (mode === 'ancient' ? '（古法要求令字位于第 1 字）' : ''),
      startedAt: Date.now(),
      updatedAt: Date.now(),
    }
  }

  /** 暂停游戏并记录原因（不负责写盘，由调用方决定是否保存现场）。 */
  function pauseGame(state: GameState, reason: string): void {
    state.phase = 'paused'
    state.pausedReason = reason
    state.lastEvent = `游戏已暂停：${reason}`
    state.updatedAt = Date.now()
  }

  /** 结束对局：置为 finished、清理暂停原因、删除快照文件。 */
  function finishGame(sessionId: string, state: GameState, message: string): void {
    state.phase = 'finished'
    state.pausedReason = ''
    state.lastEvent = message
    state.updatedAt = Date.now()
    deleteSnapshot(sessionId)
  }

  /**
   * 诗句尝试判定（Host 入口）。
   * 规则实现在 shared/rules.ts 的 judgePoemAttempt（Host 与浏览器 Client 共用，
   * 保证“对话判定”与“面板即时判定”规则一致）；这里把判定结果落回状态机
   * （得分、去重登记、古法位置推进）并生成播报文案。
   */
  function attemptPoem(state: GameState, rawText: string): void {
    const result = judgePoemAttempt({
      rawText,
      lingzi: state.lingzi,
      mode: state.mode,
      requiredPosition: state.requiredPosition,
      usedNormalized: state.usedNormalized,
    })
    // 不含令字的消息不视为诗句尝试（普通聊天直接忽略）
    if (result.kind === 'notPoem') return
    state.attempts += 1
    const t = result.display
    switch (result.kind) {
      case 'length':
        state.lastEvent = `「${t}」长度不符（需 ${MIN_LINE_CHARS}-${MAX_LINE_CHARS} 字），本次无效`
        break
      case 'duplicate':
        state.lastEvent = `「${t}」已使用过，本次无效`
        break
      case 'badPosition': {
        const pos = result.requiredPosition ?? state.requiredPosition
        state.lastEvent = result.badPosReason === 'tooShort'
          ? `「${t}」不足 ${pos} 字：古法要求令字「${state.lingzi}」位于第 ${pos} 字`
          : `位置不符：「${t}」第 ${pos} 字应为令字「${state.lingzi}」`
        break
      }
      case 'valid': {
        // 判定通过：得分 +1，诗句入已使用集合，古法推进要求位置
        state.score += 1
        state.usedPoems.push(t)
        state.usedNormalized.push(result.normalized)
        if (state.mode === 'ancient') {
          state.requiredPosition = (state.requiredPosition % MAX_ANCIENT_POSITION) + 1
        }
        state.lastEvent = `判定有效！「${t}」得分 +1（当前 ${state.score} 分）`
        break
      }
    }
    state.updatedAt = Date.now()
  }

  /** “提示”指令：消耗一次提示次数，从内置诗句库挑一句未使用的示例。 */
  function consumeHint(state: GameState): void {
    if (state.hintsLeft <= 0) {
      state.lastEvent = '提示次数已用完'
      state.updatedAt = Date.now()
      return
    }
    state.hintsLeft -= 1
    const bank = POEM_BANK[state.lingzi] ?? []
    const candidate = bank.find((entry) => !state.usedNormalized.includes(normalizeLine(entry)))
    const positionNote = state.mode === 'ancient' ? `（古法：令字「${state.lingzi}」需位于第 ${state.requiredPosition} 字）` : ''
    state.lastEvent = candidate
      ? `提示${positionNote}：例如「${candidate}」（仅作参考，请自行创作）`
      : `提示${positionNote}：请说出一句包含「${state.lingzi}」的诗句`
    state.updatedAt = Date.now()
  }

  /** 关键词指令处理（无对局时除 start 外一律忽略）。 */
  function applyCommand(sessionId: string, action: CommandAction): void {
    const existing = ensureState(sessionId)
    switch (action) {
      case 'start': {
        // 关键词默认开启简易模式；模型如需古法模式可通过 feihualing_start 工具指定
        const next = createGame(sessionId, 'simple')
        if (existing) next.lastEvent = `已重新开局（先前的对局已被替换）：${next.lastEvent}`
        games.set(sessionId, next)
        deleteSnapshot(sessionId) // 旧对局的暂停快照随新开局失效
        return
      }
      case 'stop':
        if (existing) finishGame(sessionId, existing, `游戏结束：最终得分 ${existing.score}，共使用诗句 ${existing.usedPoems.length} 句`)
        return
      case 'surrender':
        if (existing) finishGame(sessionId, existing, `玩家认输：最终得分 ${existing.score}，共使用诗句 ${existing.usedPoems.length} 句`)
        return
      case 'pause':
        if (existing && existing.phase === 'running') {
          pauseGame(existing, '玩家手动暂停')
          saveSnapshot(sessionId, existing) // 手动暂停同样保存现场
        }
        return
      case 'resume':
        if (existing && existing.phase === 'paused') {
          existing.phase = 'running'
          existing.pausedReason = ''
          existing.lastEvent = '游戏继续'
          existing.updatedAt = Date.now()
          deleteSnapshot(sessionId) // 快照与“已暂停”一一对应，恢复运行后移除
        }
        return
      case 'swap':
        if (existing && (existing.phase === 'running' || existing.phase === 'paused')) {
          existing.lingzi = pickLingzi(existing.lingzi)
          existing.requiredPosition = 1 // 古法位置从头循环
          existing.lastEvent = `令字已更换为「${existing.lingzi}」`
          existing.updatedAt = Date.now()
        }
        return
      case 'hint':
        if (existing && (existing.phase === 'running' || existing.phase === 'paused')) {
          consumeHint(existing)
        }
        return
    }
  }

  // ---------- 5. 事件监听（Harness 原生事件；随插件 fiber 卸载自动注销） ----------

  /**
   * session/event：所有会话提交事件的统一入口（untagged 监听器全局可见）。
   * 载荷为 (session, event)，据此实现需求中的 user:message / turn:before /
   * turn:after / tool:before 四类监听（映射关系见文件头注释）。
   */
  ctx.on('session/event', (session: SessionLike, event: SessionEventLike) => {
    try {
      if (session === null || typeof session !== 'object' || typeof session.id !== 'string') return
      const sessionId = session.id
      switch (event?.type) {
        // user:message —— 关键词指令 + 诗句尝试判定
        case 'user/message': {
          const data = event.data
          if (data === null || typeof data !== 'object') return
          const message = data as { role?: unknown; source?: unknown; content?: unknown }
          if (message.role !== 'user') return
          // 只处理真实用户输入；压缩摘要等系统产生的 user/message 一律忽略
          const source = message.source as { kind?: unknown } | undefined
          if (source?.kind !== 'user') return
          const text = extractText(message.content)
          if (text.trim().length === 0) return
          const normalized = normalizeLine(text)
          // 关键词指令优先级最高
          const keyword = KEYWORDS.find((entry) => entry.test(normalized))
          if (keyword) {
            applyCommand(sessionId, keyword.action)
            return
          }
          // 非指令且游戏进行中 → 按诗句尝试判定
          const state = ensureState(sessionId)
          if (state && state.phase === 'running') attemptPoem(state, text)
          return
        }
        // tool:before —— 自动暂停（shell / 文件写入类工具调用）
        case 'tool/call': {
          if (!config.autoPause) return
          const data = event.data as { name?: unknown } | undefined
          const toolName = normalizeToolName(data?.name)
          if (toolName === '' || toolName.startsWith('feihualing')) return // 本插件工具不触发
          if (!DANGEROUS_TOOL_NAMES.has(toolName)) return
          const state = ensureState(sessionId)
          if (!state || state.phase !== 'running') return
          pauseGame(state, `检测到 ${toolName} 工具调用，自动暂停`)
          saveSnapshot(sessionId, state) // 自动暂停：保存现场（需求 4）
          log('info', `[${PLUGIN_ID}] 会话 ${sessionId}: 因工具 ${toolName} 自动暂停并保存现场`)
          return
        }
        // turn:before / turn:after —— 记录轮次（供状态展示）
        case 'turn/start':
        case 'turn/end': {
          const data = event.data as { turn?: unknown } | undefined
          if (typeof data?.turn === 'number') lastTurns.set(sessionId, data.turn)
          return
        }
        default:
          return
      }
    } catch (error) {
      // 事件监听异常不允许影响宿主事件流
      log('warn', `[${PLUGIN_ID}] session/event 处理异常: ${errorMessage(error)}`)
    }
  })

  // ---------- 6. 注册 3 个模型工具（不向主聊天流输出任何内容） ----------

  /** 从工具执行上下文解析会话 id（无 agent 会话时拒绝执行）。 */
  function requireSessionId(exec: ToolRunContext): string {
    const sessionId = exec.agent?.session?.id
    if (typeof sessionId !== 'string' || sessionId.length === 0) {
      throw new Error('飞花令工具必须在 agent 会话中调用')
    }
    return sessionId
  }

  /** 构造 status 工具返回（usedPoems 返回副本，防止外部修改内部状态）。 */
  function buildStatus(state: GameState | undefined, sessionId: string): StatusResult {
    if (!state) {
      return {
        phase: 'idle',
        score: 0,
        attempts: 0,
        usedPoems: [],
        hintsLeft: 0,
        lastEvent: '当前会话没有进行中的飞花令游戏',
        turn: lastTurns.get(sessionId) ?? 0,
      }
    }
    return {
      phase: state.phase,
      mode: state.mode,
      lingzi: state.lingzi,
      score: state.score,
      attempts: state.attempts,
      usedPoems: [...state.usedPoems],
      hintsLeft: state.hintsLeft,
      // 可选字段缺省即不返回，与工具 JSON Schema（additionalProperties: false）对齐
      ...(state.mode === 'ancient' ? { requiredPosition: state.requiredPosition } : {}),
      ...(state.pausedReason === '' ? {} : { pausedReason: state.pausedReason }),
      lastEvent: state.lastEvent,
      turn: lastTurns.get(sessionId) ?? 0,
    }
  }

  /** status 的文本渲染（工具结果在 UI 中的一句话摘要）。 */
  function renderStatusText(value: StatusResult): string {
    if (value.phase === 'idle') return '当前没有进行中的飞花令游戏'
    const modeText = value.mode === 'ancient' ? '古法严格' : '简易'
    const base = `模式：${modeText}｜令字「${value.lingzi ?? '?'}」｜得分 ${value.score}｜已用诗句 ${value.usedPoems.length} 句｜剩余提示 ${value.hintsLeft} 次`
    const posText = value.mode === 'ancient' && value.requiredPosition !== undefined ? `｜令字需位于第 ${value.requiredPosition} 字` : ''
    if (value.phase === 'paused') return `游戏已暂停（${value.pausedReason ?? '原因未知'}）。${base}${posText}`
    if (value.phase === 'finished') return `游戏已结束。${base}`
    return `游戏进行中。${base}${posText}。最近判定：${value.lastEvent || '无'}`
  }

  ctx.tools.register(defineTool({
    name: 'feihualing_start',
    description:
      '开始（或重新开始）一场飞花令游戏。当用户说「开始飞花令」「开始游戏」等指令时应调用本工具；' +
      '游戏状态由插件按会话维护，调用后请以返回值中的 message 为准，用自然语言向用户宣布开局信息（模式、令字、剩余提示次数）。',
    parameters: {
      mode: {
        type: 'string',
        // 可选参数：省略 required 标记（Harness 约定 required 只能为 true，不存在则视为可选）
        enum: ['simple', 'ancient'],
        description: '游戏模式：simple=简易飞花令（诗句任意位置包含令字即可）；ancient=古法严格飞花令（令字必须位于本轮指定位置，位置按第 1 字到第 7 字循环）。缺省为 simple。',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          started: { type: 'boolean', required: true },
          phase: { type: 'string', required: true, enum: ['running', 'paused', 'finished'] },
          mode: { type: 'string', required: true, enum: ['simple', 'ancient'] },
          lingzi: { type: 'string', required: true },
          score: { type: 'integer', required: true },
          hintsLeft: { type: 'integer', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args, exec) {
      const sessionId = requireSessionId(exec)
      const requestedMode: GameMode = args.mode === 'ancient' ? 'ancient' : 'simple'
      const existing = ensureState(sessionId)
      // 已有进行中的对局 → 幂等返回现状，不重复开局
      if (existing && existing.phase === 'running') {
        const result: StartResult = {
          started: false,
          phase: 'running',
          mode: existing.mode,
          lingzi: existing.lingzi,
          score: existing.score,
          hintsLeft: existing.hintsLeft,
          message: `游戏已在进行中（模式：${existing.mode === 'ancient' ? '古法严格' : '简易'}，令字「${existing.lingzi}」），无需重复开始`,
        }
        return result
      }
      const state = createGame(sessionId, requestedMode)
      if (existing) state.lastEvent = `已重新开局（先前的对局已被替换）：${state.lastEvent}`
      games.set(sessionId, state)
      deleteSnapshot(sessionId)
      const result: StartResult = {
        started: true,
        phase: 'running', // createGame 恒定以 running 开局
        mode: state.mode,
        lingzi: state.lingzi,
        score: state.score,
        hintsLeft: state.hintsLeft,
        message: state.lastEvent,
      }
      return result
    },
    presentCall: (args) => ({ card: 'generic', title: '开始飞花令', kind: 'other', rawInput: args }),
  }))

  ctx.tools.register(defineTool({
    name: 'feihualing_status',
    description:
      '查询当前会话的飞花令游戏状态（模式、令字、得分、已使用诗句、剩余提示次数、最近判定结果等）。' +
      '当用户提交诗句或发出游戏指令（换字/提示/认输/暂停/继续飞花令等）后，插件已在后台完成判定；' +
      '请先调用本工具获取最新状态与最近判定（lastEvent），再据此以自然语言回复用户。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          phase: { type: 'string', required: true, enum: ['idle', 'running', 'paused', 'finished'] },
          mode: { type: 'string', enum: ['simple', 'ancient'] },
          lingzi: { type: 'string' },
          score: { type: 'integer', required: true },
          attempts: { type: 'integer', required: true },
          usedPoems: { type: 'array', required: true, items: { type: 'string' } },
          hintsLeft: { type: 'integer', required: true },
          requiredPosition: { type: 'integer' },
          pausedReason: { type: 'string' },
          lastEvent: { type: 'string', required: true },
          turn: { type: 'integer', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderStatusText(value) }],
    },
    async execute(_args, exec) {
      const sessionId = requireSessionId(exec)
      return buildStatus(ensureState(sessionId), sessionId)
    },
    presentCall: () => ({ card: 'generic', title: '查询飞花令状态', kind: 'other', rawInput: null }),
  }))

  ctx.tools.register(defineTool({
    name: 'feihualing_stop',
    description:
      '结束当前会话的飞花令游戏（含「结束飞花令」「认输」语义的收尾）。' +
      '调用后返回最终得分与已使用诗句数量，请以自然语言向用户播报结算结果。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          stopped: { type: 'boolean', required: true },
          finalScore: { type: 'integer', required: true },
          usedCount: { type: 'integer', required: true },
          message: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(_args, exec) {
      const sessionId = requireSessionId(exec)
      const state = ensureState(sessionId)
      if (!state || state.phase === 'finished') {
        const result: StopResult = {
          stopped: false,
          finalScore: 0,
          usedCount: 0,
          message: '当前没有进行中的飞花令游戏',
        }
        return result
      }
      finishGame(sessionId, state, `游戏结束：最终得分 ${state.score}，共使用诗句 ${state.usedPoems.length} 句`)
      const result: StopResult = {
        stopped: true,
        finalScore: state.score,
        usedCount: state.usedPoems.length,
        message: state.lastEvent,
      }
      return result
    },
    presentCall: () => ({ card: 'generic', title: '结束飞花令', kind: 'other', rawInput: null }),
  }))

  // ---------- 7. 卸载生命周期（需求：处理 plugin:unload，卸载后无残留） ----------

  /** 是否已执行过清理（幂等保护：effect 与 plugin:unload 可能先后触发）。 */
  let disposed = false

  /**
   * 卸载清理：
   *  1. 清空全部会话的游戏状态与轮次记录（内存状态无残留）；
   *  2. 删除白名单目录内全部快照文件（磁盘现场无残留）；
   *  3. 事件监听由 Cordis 随 fiber 卸载自动注销（ctx.on 挂载的 effect）。
   */
  const cleanup = (): void => {
    if (disposed) return
    disposed = true
    games.clear()
    lastTurns.clear()
    try {
      for (const fileName of fs.readdirSync(dataDir)) {
        // 只删除本插件命名空间的快照文件，白名单目录内其它内容一律不动
        if (!/^snapshot-[A-Za-z0-9._-]{1,64}\.json$/.test(fileName)) continue
        fs.unlinkSync(path.join(dataDir, fileName))
      }
    } catch {
      /* 目录不存在等情况一律忽略 */
    }
    log('info', `[${PLUGIN_ID}] 插件已卸载：全部会话状态与快照已清空`)
  }

  // 主卸载路径：Cordis fiber dispose 时执行（即需求中的 plugin:unload 语义）
  ctx.effect(() => cleanup, 'dsh-plugin-feihualing: unload cleanup')
  // 兼容兜底：若宿主额外派发字面量 'plugin:unload' 事件同样执行清理（幂等）
  ctx.on('plugin:unload', cleanup)

  log('info', `[${PLUGIN_ID}] 已加载（enable=${String(config.enable)}, maxHintCount=${config.maxHintCount}, autoPause=${String(config.autoPause)}，快照目录：${dataDir}）`)
}

// ============================================================
// 模块级辅助函数（apply 的支撑工具，无状态）
// ============================================================

/** 配置解析与严格校验；非法值抛错拒绝加载（与 cordis.yml 的 config schema 一致）。 */
function resolveConfig(raw: Partial<FeihualingConfig> | undefined): FeihualingConfig {
  const candidate: Partial<FeihualingConfig> = raw ?? {}
  const enable = candidate.enable ?? true
  const maxHintCount = candidate.maxHintCount ?? 3
  const autoPause = candidate.autoPause ?? true
  if (typeof enable !== 'boolean') {
    throw new TypeError('dsh-plugin-feihualing: config.enable 必须是布尔值')
  }
  if (typeof autoPause !== 'boolean') {
    throw new TypeError('dsh-plugin-feihualing: config.autoPause 必须是布尔值')
  }
  if (typeof maxHintCount !== 'number' || !Number.isInteger(maxHintCount) || maxHintCount < 0 || maxHintCount > 10) {
    throw new TypeError('dsh-plugin-feihualing: config.maxHintCount 必须是 0-10 的整数')
  }
  return { enable, maxHintCount, autoPause }
}

/**
 * 解析快照白名单根目录：$DSH_HOME/storages/dsh-plugin-feihualing。
 * 与 @deepseek-ai/dsh-home-paths 的约定一致：DSH_HOME 环境变量优先
 * （支持 ~ 前缀展开），否则使用 ~/.dsh。
 */
function resolveDataDir(): string {
  const envHome = process.env.DSH_HOME
  const home = envHome !== undefined && envHome.trim().length > 0
    ? path.resolve(envHome.trim().replace(/^~(?=[\\/])/, os.homedir()))
    : path.join(os.homedir(), '.dsh')
  return path.join(home, 'storages', PLUGIN_ID)
}

/**
 * 快照内容逐字段校验（读取自磁盘的数据一律视为不可信）。
 * 校验通过返回规范化 SnapshotFile，否则返回 null。
 */
function validateSnapshot(raw: unknown, sessionId: string): SnapshotFile | null {
  if (raw === null || typeof raw !== 'object') return null
  const snapshot = raw as Record<string, unknown>
  if (snapshot.version !== SNAPSHOT_VERSION) return null
  if (snapshot.plugin !== PLUGIN_ID) return null
  if (snapshot.sessionId !== sessionId) return null
  if (typeof snapshot.savedAt !== 'number') return null
  const rawState = snapshot.state
  if (rawState === null || typeof rawState !== 'object') return null
  const st = rawState as Record<string, unknown>

  if (st.sessionId !== sessionId) return null

  const rawPhase = st.phase
  if (typeof rawPhase !== 'string') return null
  const phase = rawPhase as GamePhase
  if (phase !== 'running' && phase !== 'paused' && phase !== 'finished') return null

  const rawMode = st.mode
  if (typeof rawMode !== 'string') return null
  const mode = rawMode as GameMode
  if (mode !== 'simple' && mode !== 'ancient') return null

  if (typeof st.lingzi !== 'string' || st.lingzi.length === 0) return null
  if (typeof st.score !== 'number' || !Number.isFinite(st.score)) return null
  if (typeof st.attempts !== 'number' || !Number.isFinite(st.attempts)) return null
  if (typeof st.hintsLeft !== 'number' || !Number.isFinite(st.hintsLeft)) return null
  if (typeof st.requiredPosition !== 'number' || !Number.isInteger(st.requiredPosition) || st.requiredPosition < 1) return null
  if (typeof st.pausedReason !== 'string') return null
  if (typeof st.lastEvent !== 'string') return null
  if (typeof st.startedAt !== 'number') return null
  if (typeof st.updatedAt !== 'number') return null

  const rawPoems = st.usedPoems
  if (!Array.isArray(rawPoems)) return null
  const usedPoems: string[] = []
  for (const item of rawPoems) {
    if (typeof item !== 'string') return null
    usedPoems.push(item)
  }
  const rawNormalized = st.usedNormalized
  if (!Array.isArray(rawNormalized)) return null
  const usedNormalized: string[] = []
  for (const item of rawNormalized) {
    if (typeof item !== 'string') return null
    usedNormalized.push(item)
  }
  if (usedNormalized.length > 10000) return null

  return {
    version: SNAPSHOT_VERSION,
    plugin: PLUGIN_ID,
    sessionId,
    savedAt: snapshot.savedAt as number,
    state: {
      sessionId,
      phase,
      mode,
      lingzi: st.lingzi,
      score: st.score,
      attempts: st.attempts,
      usedPoems,
      usedNormalized,
      hintsLeft: st.hintsLeft,
      requiredPosition: st.requiredPosition,
      pausedReason: st.pausedReason,
      lastEvent: st.lastEvent,
      startedAt: st.startedAt,
      updatedAt: st.updatedAt,
    },
  }
}
