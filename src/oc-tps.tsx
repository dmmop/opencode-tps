/** @jsxImportSource @opentui/solid */
import type { Context, Definition } from "@opencode-ai/plugin/tui/plugin"
import { createSignal } from "solid-js"

type StreamSample = {
  at: number
  tokens: number
}

type MessageTiming = {
  sessionID: string
  requestStartAt: number
  firstResponseAt?: number
  firstTokenAt?: number
  lastTokenAt?: number
  lastToolCallAt?: number
}

type SessionAverage = {
  totalTokens: number
  totalDurationMs: number
}

type TrackerState = {
  streamSamplesBySession: Record<string, StreamSample[]>
  lastTpsBySession: Record<string, string>
  finalizedTpsBySession: Record<string, true>
  ttftBySession: Record<string, number>
  messageTimingByID: Record<string, MessageTiming>
  sessionAverageByID: Record<string, SessionAverage>
}

const STREAM_WINDOW_MS = 5_000
const LIVE_STALE_MS = 1_500
const SINGLE_SAMPLE_MS = 1_000

const encoder = new TextEncoder()

function estimateStreamTokens(delta: string) {
  return Math.max(1, Math.ceil(encoder.encode(delta).byteLength / 5))
}

function formatRate(value: number, label: "TPS" | "AVG") {
  if (!Number.isFinite(value) || value <= 0) return undefined
  const suffix = label === "TPS" ? " TPS" : ""
  if (value >= 100) return `${Math.round(value)}${suffix}`
  if (value >= 10) return `${value.toFixed(1)}${suffix}`
  return `${value.toFixed(2)}${suffix}`
}

function formatTtft(value: number) {
  if (!Number.isFinite(value) || value < 0) return undefined
  return `${value.toFixed(1)}s`
}

function activeDurationMs(samples: StreamSample[], tailAt?: number) {
  if (samples.length === 0) return 0
  if (samples.length === 1) {
    const tailDuration = tailAt ? Math.max(0, tailAt - samples[0].at) : SINGLE_SAMPLE_MS
    return Math.min(Math.max(tailDuration, 250), SINGLE_SAMPLE_MS)
  }

  let duration = 0
  for (let i = 1; i < samples.length; i++) duration += Math.max(0, samples[i].at - samples[i - 1].at)
  if (tailAt) duration += Math.max(0, tailAt - samples[samples.length - 1].at)
  return Math.max(duration, SINGLE_SAMPLE_MS)
}

function calculateTps(samples: StreamSample[], now: number) {
  const relevant = samples.filter((sample) => now - sample.at <= STREAM_WINDOW_MS)
  if (relevant.length === 0) return undefined

  const lastSample = relevant[relevant.length - 1]
  if (!lastSample || now - lastSample.at > LIVE_STALE_MS) return undefined

  const total = relevant.reduce((sum, sample) => sum + sample.tokens, 0)
  const durationSeconds = activeDurationMs(relevant, now) / 1000
  if (durationSeconds <= 0) return undefined
  return formatRate(total / durationSeconds, "TPS")
}

function SessionPromptRight(props: {
  context: Context
  sessionID: string
  tracker: TrackerState
  version: () => number
}) {
  const sessionAverage = () => {
    const totals = props.tracker.sessionAverageByID[props.sessionID]
    if (!totals || totals.totalTokens <= 0 || totals.totalDurationMs <= 0) return undefined
    return formatRate(totals.totalTokens / (totals.totalDurationMs / 1000), "AVG")
  }

  const sessionTtft = () => {
    const ttftMs = props.tracker.ttftBySession[props.sessionID]
    return typeof ttftMs === "number" ? formatTtft(ttftMs / 1000) : undefined
  }

  const liveTps = () => {
    if (props.tracker.finalizedTpsBySession[props.sessionID]) return undefined
    const samples = props.tracker.streamSamplesBySession[props.sessionID] ?? []
    const rate = calculateTps(samples, Date.now())
    if (rate) props.tracker.lastTpsBySession[props.sessionID] = rate
    return rate
  }

  const statusText = () => {
    props.version()
    const live = liveTps() ?? props.tracker.lastTpsBySession[props.sessionID] ?? "-"
    const avg = sessionAverage() ?? "-"
    const ttft = sessionTtft() ?? "-"
    return `TPS ${live} | AVG ${avg} | TTFT ${ttft}`
  }

  return <text fg={props.context.theme.text.subdued}>{statusText()}</text>
}

function addAverage(tracker: TrackerState, sessionID: string, tokens: number, durationMs: number) {
  const totals = tracker.sessionAverageByID[sessionID] ?? {
    totalTokens: 0,
    totalDurationMs: 0,
  }
  tracker.sessionAverageByID[sessionID] = {
    totalTokens: totals.totalTokens + tokens,
    totalDurationMs: totals.totalDurationMs + durationMs,
  }
}

const plugin = {
  id: "oc-tps",
  setup(context) {
    const tracker: TrackerState = {
      streamSamplesBySession: {},
      lastTpsBySession: {},
      finalizedTpsBySession: {},
      ttftBySession: {},
      messageTimingByID: {},
      sessionAverageByID: {},
    }
    const [version, setVersion] = createSignal(0)

    const bump = () => setVersion((value) => value + 1)

    const pruneSamples = (now = Date.now()) => {
      let changed = false

      for (const [sessionID, samples] of Object.entries(tracker.streamSamplesBySession)) {
        const next = samples.filter((sample) => now - sample.at <= STREAM_WINDOW_MS)
        if (next.length !== samples.length) {
          changed = true
          if (next.length > 0) tracker.streamSamplesBySession[sessionID] = next
          else delete tracker.streamSamplesBySession[sessionID]
        }
      }

      if (changed) bump()
    }

    const clearLiveSamples = (sessionID: string) => {
      if (!tracker.streamSamplesBySession[sessionID]?.length) return
      delete tracker.streamSamplesBySession[sessionID]
      bump()
    }

    const finalizeTps = (sessionID: string, at: number) => {
      const rate = calculateTps(tracker.streamSamplesBySession[sessionID] ?? [], at)
      if (rate) tracker.lastTpsBySession[sessionID] = rate
      tracker.finalizedTpsBySession[sessionID] = true
    }

    const appendSample = (sessionID: string, messageID: string, delta: string) => {
      const now = Date.now()
      tracker.streamSamplesBySession[sessionID] = [
        ...(tracker.streamSamplesBySession[sessionID] ?? []).filter((item) => now - item.at <= STREAM_WINDOW_MS),
        { at: now, tokens: estimateStreamTokens(delta) },
      ]

      const timing = tracker.messageTimingByID[messageID]
      if (timing) {
        if (!timing.firstTokenAt) tracker.ttftBySession[sessionID] = Math.max(now - timing.requestStartAt, 0)
        tracker.messageTimingByID[messageID] = timing.firstTokenAt
          ? { ...timing, lastTokenAt: now }
          : {
              ...timing,
              firstResponseAt: timing.firstResponseAt ?? now,
              firstTokenAt: now,
              lastTokenAt: now,
            }
      }
      bump()
    }

    const onStepStarted = context.data.on("session.step.started", (event) => {
      delete tracker.lastTpsBySession[event.data.sessionID]
      delete tracker.finalizedTpsBySession[event.data.sessionID]
      delete tracker.ttftBySession[event.data.sessionID]
      tracker.messageTimingByID[event.data.assistantMessageID] = {
        sessionID: event.data.sessionID,
        requestStartAt: event.created,
      }
      bump()
    })

    const onTextDelta = context.data.on("session.text.delta", (event) => {
      appendSample(event.data.sessionID, event.data.assistantMessageID, event.data.delta)
    })

    const onReasoningDelta = context.data.on("session.reasoning.delta", (event) => {
      appendSample(event.data.sessionID, event.data.assistantMessageID, event.data.delta)
    })

    const onToolInputDelta = context.data.on("session.tool.input.delta", (event) => {
      appendSample(event.data.sessionID, event.data.assistantMessageID, event.data.delta)
    })

    const onToolInputStarted = context.data.on("session.tool.input.started", (event) => {
      clearLiveSamples(event.data.sessionID)
      const timing = tracker.messageTimingByID[event.data.assistantMessageID]
      if (!timing) return
      tracker.messageTimingByID[event.data.assistantMessageID] = {
        ...timing,
        firstResponseAt: timing.firstResponseAt ?? event.created,
        lastToolCallAt: event.created,
      }
      bump()
    })

    const onToolCalled = context.data.on("session.tool.called", (event) => {
      clearLiveSamples(event.data.sessionID)
      const timing = tracker.messageTimingByID[event.data.assistantMessageID]
      if (!timing) return
      tracker.messageTimingByID[event.data.assistantMessageID] = {
        ...timing,
        firstResponseAt: timing.firstResponseAt ?? event.created,
        lastToolCallAt: event.created,
      }
      bump()
    })

    const onToolSuccess = context.data.on("session.tool.success", (event) => clearLiveSamples(event.data.sessionID))
    const onToolFailed = context.data.on("session.tool.failed", (event) => clearLiveSamples(event.data.sessionID))

    const onStepEnded = context.data.on("session.step.ended", (event) => {
      finalizeTps(event.data.sessionID, event.created)
      const timing = tracker.messageTimingByID[event.data.assistantMessageID]
      if (timing?.sessionID === event.data.sessionID && typeof timing.firstResponseAt === "number") {
        const totalTokens = event.data.tokens.output + event.data.tokens.reasoning
        const endAt = event.data.finish === "tool-calls" ? timing.lastToolCallAt : event.created
        const durationMs = typeof endAt === "number" ? Math.max(endAt - timing.firstResponseAt, 1) : undefined
        if (totalTokens > 0 && durationMs) addAverage(tracker, event.data.sessionID, totalTokens, durationMs)
      }

      delete tracker.messageTimingByID[event.data.assistantMessageID]
      pruneSamples(event.created)
      bump()
    })

    const onStepFailed = context.data.on("session.step.failed", (event) => {
      finalizeTps(event.data.sessionID, event.created)
      delete tracker.messageTimingByID[event.data.assistantMessageID]
      bump()
    })

    const unregisterSlot = context.ui.slot("session.composer.top", (value) => (
      <SessionPromptRight
        context={context}
        sessionID={value.sessionID}
        tracker={tracker}
        version={version}
      />
    ))

    const timer = setInterval(() => {
      pruneSamples()
      bump()
    }, 1000)

    return () => {
      onStepStarted()
      onTextDelta()
      onReasoningDelta()
      onToolInputDelta()
      onToolInputStarted()
      onToolCalled()
      onToolSuccess()
      onToolFailed()
      onStepEnded()
      onStepFailed()
      unregisterSlot()
      clearInterval(timer)
    }
  },
} satisfies Definition

export default plugin
