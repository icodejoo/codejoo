---
name: stomp
description: >-
  Work on @codejoo/stomp (apps/stomp) — the framework-agnostic STOMP-over-WebSocket
  client wrapper (top-level class Stompsocket) over @stomp/stompjs. Read BEFORE modifying
  src/index.ts, its tests, or the READMEs. Covers architecture, the non-obvious invariants
  that tests depend on, and the verify workflow. Triggers on: STOMP, Stompsocket, stompjs,
  subscribe/unsubscribe, ack/nack, reconnect re-subscribe, offline send buffer, beforeConnect
  token refresh, binaryDecoder, connection-state observation.
---

# @codejoo/stomp

`apps/stomp` — a **framework-agnostic** product-layer wrapper over
[`@stomp/stompjs`](https://github.com/stomp-js/stompjs). Package `@codejoo/stomp`, top-level
class **`Stompsocket`**. It is a TS port of the Dart `flutter_stompsocket` (same class name);
Web version parses synchronously so it drops Dart's `ordered`/isolate machinery.

The whole implementation is **one file**: `src/index.ts` (~620 lines, no sub-modules). Tests
live in `test/stomp.test.ts` driven by an in-repo minimal broker `test/broker.ts`.

## The core problem it solves

`@stomp/stompjs` reconnects the **transport** but does **not** restore your subscriptions.
`Stompsocket` keeps a local subscription registry (`Map<id, Subscription>`) and **replays it in
`onConnect`** (`handleConnect`). Everything else is layered on that.

## Architecture map (all in `src/index.ts`)

- **Subscription registry** — `subscriptions: Map<string, Subscription>`. Each `Subscription`
  holds a `callbacks: CallbackReg[]` queue. Same `id` → callbacks share ONE parsed payload
  (parse once in `onIncoming`, dispatch to all via `runCallbacks`), and only ONE wire
  `SUBSCRIBE` is sent. STOMP subscription id is set explicitly to our id (`openOnWire`) so
  stompjs's auto `sub-N` ids can't break id-based unsubscribe/dedup.
- **Ref-counted unsubscribe** — the handle's `unsubscribe()` (`cancelReg`) removes one
  `CallbackReg`; the wire `UNSUBSCRIBE` only fires when the last callback for an id is gone.
  Also `unsubscribe({ id | destination })` and `clear()`.
- **Offline send buffer** — `outbox: Outbound[]`. `send()` while disconnected buffers (capped by
  `maxQueuedMessages`, drops oldest); `flushOutbox()` replays in order on connect. `sendNow`
  chooses publish shape by body type (Uint8Array → binaryBody, string → body, object → JSON +
  `content-type: application/json`, undefined → no body).
- **Ack modes** (`AckMode`): `auto` (STOMP `ack:auto`, wrapper sends nothing), `smart`
  (`client-individual`, auto-ACK on all-callbacks-success / NACK on any throw or parse failure
  per `onParseError`), `manual` (`client-individual`, wrapper sends nothing; callback's 2nd arg
  `AckControl` acks/nacks — storable and callable OUTSIDE the callback). Logic is the `switch`
  in `onIncoming`.
- **Session generation** — `generation` increments each `handleConnect`. `makeAck` captures the
  gen; a `manual` `AckControl` no-ops after reconnect (stale) and is idempotent (`used` flag).
- **Connection state** — `ConnectionState` (idle/connecting/connected/reconnecting/disconnected),
  observed framework-agnostically via `state` getter, `onState(listener)`, and `onStateChanged`
  callback. Vue bridges in 2 lines to a `ref`.
- **beforeConnect** — `handleBeforeConnect` runs the user hook before every (re)connect, swallows
  errors, and overwrites `connectHeaders` — enables async token refresh on every reconnect.
- **Foreground-resume reconnect** — `resumeOnForeground` adds `visibilitychange`/`online`
  listeners that call `forceReconnect()` (deactivate+activate, skipping `reconnectDelay`) to
  sidestep Chromium background-tab timer throttling (stompjs #335/#669). Guarded for non-browser
  (no `document`/`window`).
- **copyWith / dispose** — `copyWith` returns a fresh un-connected instance merging `opts`.
  `dispose(keepSubscriptions=false)` is reversible: you can `activate()` again;
  `keepSubscriptions=true` retains the registry for auto-replay (pause/resume).

## Non-obvious invariants — do NOT break these

1. **No `enum`, no runtime-type syntax.** Repo sets `erasableSyntaxOnly: true`
   (`tsconfig.base.json`). `AckMode`/`ParseFailureAck`/`ConnectionState` are `as const` objects
   with a matching `type` alias — keep that pattern; never introduce `enum` or parameter
   properties.
2. **Binary is detected by `content-type: application/octet-stream` (prefix match, params
   allowed), NOT `isBinaryBody`.** stompjs sets `isBinaryBody=true` on almost every received
   frame (it lazily UTF-8 decodes `message.body`), so it's useless for the decision. See
   `parse()`. The test broker sends binary by transmitting a *binary WS frame* (`test/broker.ts`
   `sendFrame(..., binary)`). A parse failure (undecodable binary) also fires the global
   `onParseFailure` option — the only observability hook for messages dropped in `auto` mode.
3. **JSON top level does NOT have to be an object.** `parse()` returns whatever `JSON.parse`
   produces — object, array, string, number, boolean, `null` — as `ParsedMessage = JsonMessage |
   string | number | boolean | null | unknown[]`. Only a genuine `JSON.parse` failure (not valid
   JSON at all) falls back to the raw decoded text, so the callback still sees something instead
   of the message silently NACKing. A real parse *failure* (drives `onParseError`) now only
   happens for the binary path: `content-type: application/octet-stream` (or non-UTF-8 bytes)
   with no `binaryDecoder` configured, or a `binaryDecoder` that itself throws.
4. **Same-id callbacks share the exact same parsed object reference** (test asserts `a === b`).
   Don't clone per-callback.
5. **`onIncoming` re-checks `subscriptions.get(sub.id) === sub`** before dispatching — a sub may
   have been cancelled or re-created under the same id. Keep that guard.
6. **`runCallbacks` iterates a `.slice()` copy** so a callback can (un)subscribe mid-dispatch.
7. **State transitions**: `activate`→connecting; `handleConnect`→connected; `handleWebSocketClose`
   → reconnecting (if `reconnectDelay>0` and still `wantConnection`) else disconnected; `dispose`
   → disconnected. `dispose` sets `wantConnection=false` first so the close handler won't override.

## Build & config

- Build chain is **vite-plus** (`vp` CLI), NOT native vite (unlike `apps/openapi`/`apps/http`).
  `vp pack` reads `vite.config.ts` (`defineConfig` from `vite-plus`): ESM only, browser platform,
  `es2022`, dts via tsgo, output `dist/esm/index.mjs` + `.d.mts` (fixed extensions).
- `@stomp/stompjs` is a **peer dependency** (`^7.0.0`) — it's in devDeps for building/testing only;
  consumers install it themselves. Don't move it to `dependencies`.
- Lint/format: `vp lint -c oxlint.config.ts` (type-aware oxlint) + `vp fmt -c oxfmt.config.ts`.
  `pnpm check` runs both (fmt --check + lint).

## Verify workflow

Acceptance = **`pnpm test` green** (34 tests via vitest through `vp test`). Tests spin up a real
`ws` WebSocketServer (`StompTestBroker`) on an ephemeral port and assert on captured frames
(`broker.framesOf("ACK"|"NACK"|"SUBSCRIBE"|"SEND"|...)`, `broker.subscriptionCount`). Reconnect
tests use `broker.dropConnections()`. Prefer extending the broker over mocking stompjs.

```bash
cd apps/stomp
pnpm test          # vitest — the real acceptance gate
pnpm check         # oxfmt --check + type-aware oxlint (run before publishing)
pnpm build         # vp pack → dist/esm
```

When changing behavior, add/adjust a test in `test/stomp.test.ts` and, if you touch public API,
update BOTH `README.md` (EN, concise) and `README.zh-CN.md` (ZH, full API tables). The two must
stay in sync.
