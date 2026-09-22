import { expect, test } from "bun:test"
import { Plugin } from "@opencode/plugin/tui"
import plugin from "../tui.ts"
import { composerForeground } from "../src/oc-tps.tsx"

test("publishes the conventional root TUI entrypoint", async () => {
  const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json()

  expect(manifest.exports["./tui"]).toBe("./tui.ts")
  expect(manifest.files).toContain("tui.ts")
  expect(plugin.id).toBe("oc-tps")
  expect(plugin.setup).toBeFunction()
})

test("registers the V2 composer slot and releases all resources", () => {
  type SlotClaim = Parameters<Plugin.Context["ui"]["slot"]>[0]
  const claims: SlotClaim[] = []
  const unsubscribed: string[] = []
  let slotReleased = false

  const cleanup = plugin.setup({
    data: {
      on: (type: string) => () => unsubscribed.push(type),
    },
    ui: {
      slot: (claim: SlotClaim) => {
        claims.push(claim)
        return () => {
          slotReleased = true
        }
      },
    },
    theme: {},
  } as Plugin.Context)

  expect(claims).toHaveLength(1)
  expect(claims[0]?.append).toBe("session.composer.top")
  expect(claims[0]?.render).toBeFunction()
  expect(cleanup).toBeFunction()
  cleanup?.()
  expect(unsubscribed).toEqual([
    "session.step.started",
    "session.text.delta",
    "session.reasoning.delta",
    "session.tool.input.delta",
    "session.tool.input.started",
    "session.tool.called",
    "session.tool.success",
    "session.tool.failed",
    "session.step.ended",
    "session.step.failed",
  ])
  expect(slotReleased).toBeTrue()
})

test("composer foreground prefers the post-2.0.9 muted token", () => {
  type TextTokens = Plugin.Context["theme"]["text"]
  const text = (tokens: Record<string, string>) => tokens as unknown as TextTokens

  expect(composerForeground(text({ muted: "muted", subdued: "subdued" }))).toBe("muted")
  expect(composerForeground(text({ muted: "muted" }))).toBe("muted")
  expect(composerForeground(text({ subdued: "subdued" }))).toBe("subdued")
})
