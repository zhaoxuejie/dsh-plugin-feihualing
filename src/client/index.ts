/**
 * 客户端半边入口（dsh-plugin-feihualing/client）。
 * 唯一职责：注入样式并组装各 UI 面注册（当前：会话头游戏开关按钮 + 浮层面板）。
 * 只做纯插槽注册，不受 harness 的 WEB_SETTINGS_NAMESPACES 白名单影响，装完即用。
 * @module dsh-plugin-feihualing/client
 */

import type { LocalContext } from './types.ts'
import { injectStyles } from './styles.ts'
import { registerHeaderButton } from './header-button.tsx'

/** 依赖的服务：slots 就绪后本插件才会加载。 */
export const inject = ['slots']

/** 客户端插件主体。 */
export function apply(ctx: LocalContext): void {
  // 样式表随插件生命周期注入/移除（ctx.effect 由 cordis 客户端运行时提供）
  const effect = (ctx as { effect?: (execute: () => (() => void) | void, label?: string) => void }).effect
  const disposeStyles = injectStyles()
  if (effect) {
    effect(() => disposeStyles, 'dsh-plugin-feihualing: client styles')
  }
  registerHeaderButton(ctx)
}
