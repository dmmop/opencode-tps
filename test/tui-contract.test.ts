import { expect, test } from "bun:test"
import type { Context } from "@opencode-ai/plugin/tui/plugin"
import type { SlotClaim } from "@opencode-ai/plugin/tui/context"
import plugin from "../src/oc-tps.tsx"

test("claims the composer slot using SlotClaim", () => {
  const claims: SlotClaim[] = []

  const cleanup = plugin.setup({
    data: { on: () => () => {} },
    ui: { slot: (claim: SlotClaim) => (claims.push(claim), () => {}) },
    theme: {},
  } as Context)

  expect(claims).toHaveLength(1)
  expect(claims[0]?.append).toBe("session.composer.top")
  expect(claims[0]?.render).toBeFunction()
  expect(cleanup).toBeFunction()
  cleanup?.()
})
