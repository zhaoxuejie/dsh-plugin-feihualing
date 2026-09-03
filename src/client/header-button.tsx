/**
 * 会话标题游戏开关按钮（conversation.session.header.actions 插槽，session 级 list）。
 * 点击后直接渲染浮层游戏面板（fixed 定位，无需 react-dom portal——
 * client 半边仅依赖 DSH 模块表确认提供的 react）。
 * 对局状态常驻本组件：关闭面板只隐藏，不丢局；隐藏期间倒计时暂停（见 useGame）。
 * @module dsh-plugin-feihualing/client/header-button
 */

import React from 'react'
import { HEADER_ORDER, NAMESPACE } from './constants.ts'
import type { LocalContext } from './types.ts'
import { GamePanel } from './panel.tsx'
import { useGamePanel } from './game/useGame.ts'

/** 在会话头操作行注册游戏开关按钮。 */
export function registerHeaderButton(ctx: LocalContext): void {
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register(
    {
      name: 'conversation.session.header.actions',
      id: NAMESPACE,
      order: HEADER_ORDER,
      inject: (sessionId) => ({ sessionId }),
    },
    HeaderButton,
  ))
}

/** 会话头游戏开关按钮 + 浮层面板（open 时渲染，fixed 定位于视口右上）。 */
function HeaderButton(props: { sessionId?: string }): React.ReactElement {
  const [open, setOpen] = React.useState(false)
  // 对局状态提升到按钮层：面板开合不影响对局，隐藏 = 暂停计时
  const api = useGamePanel(open)
  const sessionId = props.sessionId ?? ''
  const toggle = React.useCallback(() => setOpen((prev) => !prev), [])

  return (
    <React.Fragment>
      <button
        type="button"
        className="fhl-toggle"
        data-active={open ? 'true' : 'false'}
        onClick={toggle}
        title={open ? '收起飞花令（对局保留）' : '飞花令小游戏'}
        aria-label="飞花令小游戏"
      >
        🎴
      </button>
      {open && <GamePanel sessionId={sessionId} onClose={() => setOpen(false)} api={api} />}
    </React.Fragment>
  )
}
