/**
 * 共享判定规则（Host 与 Client 浏览器两半共同使用）。
 * 纯函数、零平台依赖：不允许 import node:* / DOM —— 保证「对话判定」与
 * 「面板即时判定」对同一输入给出完全一致的结果。
 * @module dsh-plugin-feihualing/shared/rules
 */

/** 游戏模式：simple 简易 / ancient 古法严格。 */
export type GameMode = 'simple' | 'ancient'

/** 诗句尝试的最小/最大长度（规范化后字符数）。 */
export const MIN_LINE_CHARS = 4
export const MAX_LINE_CHARS = 48

/** 古法令字位置循环上限（第 1 字 → 第 7 字 → 第 1 字）。 */
export const MAX_ANCIENT_POSITION = 7

/**
 * 规范化一行文本：去除空白与常见中英文标点，仅保留汉字/字母/数字。
 * 用于关键词匹配与诗句去重比较。
 */
export function normalizeLine(raw: string): string {
  return raw.replace(/[\s，。！？、；：""''（）《》〈〉【】\[\]·,.!?;:'"()\-—…]+/gu, '')
}

/** 去掉文本首尾空白（用于展示时压缩用户输入的换行/空格）。 */
export function trimDisplay(raw: string): string {
  return raw.trim().replace(/\s+/gu, ' ').slice(0, MAX_LINE_CHARS)
}

/** 一次诗句判定的输入（与 GameState 中参与判定的字段一一对应）。 */
export interface JudgeInput {
  rawText: string
  lingzi: string
  mode: GameMode
  /** 古法本轮要求令字位置（1 起）；simple 模式忽略。 */
  requiredPosition: number
  /** 已使用诗句的规范化集合（去重依据）。 */
  usedNormalized: readonly string[]
}

/** 判定结果分类。 */
export type JudgeKind =
  | 'notPoem' // 规范化后不含令字 → 视为普通聊天，不判定
  | 'length' // 长度不符（4-48 字之外）
  | 'duplicate' // 与已使用诗句重复
  | 'badPosition' // 古法模式位置不符
  | 'valid'

/** 古法位置错误的细分原因（badPosition 时有效）。 */
export type BadPositionReason = 'tooShort' | 'mismatch'

export interface JudgeResult {
  kind: JudgeKind
  /** 规范化文本（valid 时用于登记去重与位置推进）。 */
  normalized: string
  /** 展示用文本（压缩空白、截断）。 */
  display: string
  /** 规范化后长度。 */
  length: number
  /** badPosition 的细分原因；其余 kind 时为 undefined。 */
  badPosReason?: BadPositionReason
  /** badPosition 时本轮要求的位置；其余 kind 时为 undefined。 */
  requiredPosition?: number
}

/**
 * 诗句判定核心（纯函数，Host/Client 共用）。
 * 判定顺序与对话版完全一致：含令字门槛 → 长度 → 去重 → 古法位置。
 */
export function judgePoemAttempt(input: JudgeInput): JudgeResult {
  const normalized = normalizeLine(input.rawText)
  const display = trimDisplay(input.rawText)
  // 不含令字的消息不视为诗句尝试（普通聊天直接忽略）
  if (!normalized.includes(input.lingzi)) {
    return { kind: 'notPoem', normalized, display, length: normalized.length }
  }
  if (normalized.length < MIN_LINE_CHARS || normalized.length > MAX_LINE_CHARS) {
    return { kind: 'length', normalized, display, length: normalized.length }
  }
  if (input.usedNormalized.includes(normalized)) {
    return { kind: 'duplicate', normalized, display, length: normalized.length }
  }
  if (input.mode === 'ancient') {
    const pos = input.requiredPosition
    if (normalized.length < pos) {
      return { kind: 'badPosition', badPosReason: 'tooShort', requiredPosition: pos, normalized, display, length: normalized.length }
    }
    if (normalized[pos - 1] !== input.lingzi) {
      return { kind: 'badPosition', badPosReason: 'mismatch', requiredPosition: pos, normalized, display, length: normalized.length }
    }
  }
  return { kind: 'valid', normalized, display, length: normalized.length }
}
