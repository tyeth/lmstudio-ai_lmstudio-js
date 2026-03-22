# LM Studio GitHub Pages Playground

Static playground for exercising `@lmstudio/sdk` from the browser and hosting on GitHub Pages. It lets you:

- Point to a local or remote LM Studio server (WebSocket + HTTP) with optional API tokens
- Browse `/v1/models` over REST, list/downloaded/loaded models, and set the active target
- Load models, stream chat responses, and upload images for vision-capable models
- Tweak generation knobs (temperature, top‑P/K, penalties, stop strings, speculative decoding, image limits)
- Surface reasoning blocks and merge custom JSON overrides for future options (thinking, remote MCP, raw KV configs)

## Run locally

```bash
# from repo root after installing dependencies
npm run dev --workspace @lmstudio/gh-pages-demo
```

To ship the static bundle used for GitHub Pages:

```bash
npm run build --workspace @lmstudio/gh-pages-demo
```

## Connecting to LM Studio

- Start LM Studio with CORS enabled so the page can reach it: `lms server start --cors --api-token <token>`
- Use the WebSocket URL (e.g., `ws://127.0.0.1:1234`) and, if needed, set the HTTP base for REST browsing.
- API tokens are optional; when provided they are sent as `Authorization: Bearer …` for REST and passed to the SDK.

The app stores settings locally (toggleable), derives a relative Vite `base` for GitHub Pages, and keeps build artifacts
out of Git via the package `.gitignore`.
