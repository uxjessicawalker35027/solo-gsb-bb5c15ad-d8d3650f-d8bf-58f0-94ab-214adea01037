// 规划计算 Web Worker：
// 接收主线程提交的带版本号输入快照，复用既有 plan() 分配引擎（算法与结果结构不变），
// 回传同版本号的完整 PlanResult。被替代的任务由主线程直接 terminate 本 Worker。
import { plan } from '../lib/planner'
import type { PlanResult, PlannerInput } from '../lib/types'

export interface PlanRequestMessage {
  type: 'plan'
  /** 单调递增的输入快照版本；仅与请求版本一致的结果才允许被发布 */
  version: number
  input: PlannerInput
}

export interface PlanResultMessage {
  type: 'result'
  version: number
  result: PlanResult
}

export interface PlanErrorMessage {
  type: 'error'
  version: number
  message: string
}

export type PlanWorkerOutMessage = PlanResultMessage | PlanErrorMessage

const workerScope = self as unknown as {
  onmessage: ((ev: MessageEvent<PlanRequestMessage>) => void) | null
  postMessage(message: PlanWorkerOutMessage): void
}

workerScope.onmessage = (ev: MessageEvent<PlanRequestMessage>) => {
  const msg = ev.data
  if (!msg || msg.type !== 'plan') return
  try {
    const result = plan(msg.input)
    workerScope.postMessage({ type: 'result', version: msg.version, result })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    workerScope.postMessage({ type: 'error', version: msg.version, message })
  }
}
