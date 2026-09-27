import { useEffect, useRef, useState } from 'react'
import type { PlanResult, PlannerInput } from './types'
import type {
  PlanErrorMessage,
  PlanRequestMessage,
  PlanResultMessage,
} from '../workers/planner.worker'

export type PlannerStatus = 'computing' | 'ready' | 'error'

export interface PlannerState {
  /** 最近一次成功发布的完整规划结果（仅当前版本可写入；初始为空输入结果） */
  result: PlanResult | null
  status: PlannerStatus
  /** status === 'error' 时的错误信息（Worker 异常） */
  error: string | null
  /** 新输入产生后立即为 true，当前版本完整结果到达后恢复 false */
  busy: boolean
}

/**
 * 把规划计算托管给 Web Worker：
 * - 输入（父网段 / 保留区 / 需求 / 基线 / 重排开关）任意变化时，提交带递增版本的输入快照；
 * - 每次新快照终止并丢弃上一个 Worker（被替代的任务不再可能回发消息）；
 * - 只有当前版本的完整结果可以发布，过期消息（理论上不会到达）一律忽略；
 * - Worker 异常时置错误态并保留全部输入，下次编辑触发新快照即可恢复；
 * - 清空与卸载均终止任务。
 */
export function usePlanner(input: PlannerInput): PlannerState {
  const [state, setState] = useState<PlannerState>({
    result: null,
    status: 'computing',
    error: null,
    busy: true,
  })

  const workerRef = useRef<Worker | null>(null)
  const versionRef = useRef(0)

  useEffect(() => {
    // 新版本快照：先终止被替代的任务，再创建专属 Worker
    workerRef.current?.terminate()
    const version = versionRef.current + 1
    versionRef.current = version

    setState((prev) => ({ ...prev, status: 'computing', error: null, busy: true }))

    let worker: Worker
    try {
      worker = new Worker(new URL('../workers/planner.worker.ts', import.meta.url), {
        type: 'module',
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setState((prev) => ({ ...prev, status: 'error', error: message, busy: false }))
      return
    }
    workerRef.current = worker

    worker.onmessage = (ev: MessageEvent<PlanResultMessage | PlanErrorMessage>) => {
      // 仅当前版本的消息可发布；过期消息不得覆盖新结果
      if (ev.data.version !== versionRef.current) return
      if (ev.data.type === 'result') {
        const { result } = ev.data
        setState({ result, status: 'ready', error: null, busy: false })
      } else {
        const { message } = ev.data
        setState((prev) => ({ ...prev, status: 'error', error: message, busy: false }))
      }
    }

    worker.onerror = (ev: ErrorEvent) => {
      if (version !== versionRef.current) return
      setState((prev) => ({
        ...prev,
        status: 'error',
        error: ev.message || '规划 Worker 发生未知错误',
        busy: false,
      }))
    }

    const request: PlanRequestMessage = { type: 'plan', version, input }
    worker.postMessage(request)

    return () => {
      // 输入变化（任务被替代）、清空或卸载：终止任务
      worker.terminate()
      if (workerRef.current === worker) workerRef.current = null
    }
  }, [input])

  return state
}
