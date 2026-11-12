import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { monitorApi } from '../api/client'

/**
 * Whether a thesis experiment is running. Shop requests are real traffic in the experiment's
 * logs, so while one runs the site shows a pause page and sends nothing to the gateway. The
 * check goes to the ml-detector (/monitor), which adds nothing to the analysed logs.
 */
export interface ExperimentState {
  /** true until the first answer (the shop waits, so it never sends traffic before knowing) */
  checking: boolean
  /** name of the running experiment, or null */
  running: string | null
  /** false when the monitor could not be asked; the shop then works with a warning */
  monitorReachable: boolean
}

const ExperimentContext = createContext<ExperimentState>({ checking: false, running: null, monitorReachable: true })

export function experimentName(lock: { out?: string } | null): string | null {
  if (!lock) return null
  const out = lock.out ?? 'unknown'
  return out.split('/').filter(Boolean).pop() ?? out
}

export function ExperimentProvider({ children, intervalMs = 15000 }: { children: ReactNode; intervalMs?: number }) {
  const [state, setState] = useState<ExperimentState>({ checking: true, running: null, monitorReachable: true })

  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const status = await monitorApi.status()
        if (!cancelled) setState({ checking: false, running: experimentName(status.experiment_running), monitorReachable: true })
      } catch {
        if (!cancelled) setState((s) => ({ checking: false, running: s.running, monitorReachable: false }))
      }
    }
    void check()
    const timer = intervalMs > 0 ? window.setInterval(check, intervalMs) : undefined
    return () => {
      cancelled = true
      if (timer) window.clearInterval(timer)
    }
  }, [intervalMs])

  return <ExperimentContext.Provider value={state}>{children}</ExperimentContext.Provider>
}

export function useExperiment(): ExperimentState {
  return useContext(ExperimentContext)
}
