# opencode-tps

OpenCode TUI plugin that displays response performance metrics while a session is running.

## Features

- Live tokens-per-second (TPS) estimate for the active response.
- Session-wide average output and reasoning token rate (AVG).
- Time to first token (TTFT).
- Tracks text, reasoning, and tool-input streaming events.
- Uses the OpenCode TUI session composer slot without changing conversation output.

## Development

Requirements:

- Bun
- An OpenCode V2 environment with TUI plugin support

Install dependencies:

```bash
bun install
```

The plugin entrypoint is `src/index.ts`. Load that entrypoint using your OpenCode plugin configuration while developing locally.

## Metric notes

TPS is an estimate based on the byte length of streamed deltas. AVG is calculated from the output and reasoning token counts reported when a session step ends. TTFT measures the time from the start of a session step until the first streamed token.

## License

MIT
