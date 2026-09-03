/**
 * 客户端半边的最小结构类型。
 * 运行时实例全部来自 ctx 服务（slots 注入），不 import 任何 @deepseek-ai 客户端包
 * （依赖纪律：跨插件值导入会带来版本分裂），结构与真实契约是子集关系。
 * @module dsh-plugin-feihualing/client/types
 */

/** 一次 slots.register 的最小选项（dsh-client-ui-slots 的 ErasedOptions 结构子集）。 */
export interface SlotOptions {
  /** 目标插槽名，如 'conversation.session.header.actions'。 */
  name: string
  /** keyed 插槽的键（本插件不使用）。 */
  key?: string
  /** list 插槽的条目标识；同插槽内唯一。 */
  id?: string
  /** 渲染顺序；越小越靠前（list 条目按 order 升序渲染）。 */
  order?: number
  /** 列表条目显示标签（本插件用图标按钮，可不设）。 */
  label?: string
  /** session 级插槽的注入工厂：收到 sessionId，返回注入给组件的面。 */
  inject?: (sessionId: string) => Record<string, unknown>
}

/** 浏览器插槽服务的最小面（dsh-client-ui-slots 的结构子集）。 */
export interface SlotsLike {
  /** 等目标插槽被声明后注册贡献；返回移除该贡献的 disposer。 */
  inject(name: string, register: () => unknown): void
  /** 向一个已声明的插槽注册一项贡献（组件实参类型与真实 API 一致，为 unknown）。 */
  register(options: SlotOptions, component: unknown): unknown
}

/** 客户端插件消费的根上下文最小面（仅 slots）。 */
export interface LocalContext {
  slots: SlotsLike
}
