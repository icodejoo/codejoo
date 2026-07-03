# @codejoo/stomp

> 中文文档见 [README.zh-CN.md](./README.zh-CN.md)（含完整 API 说明）。

Framework-agnostic STOMP-over-WebSocket client wrapper over [`@stomp/stompjs`](https://github.com/stomp-js/stompjs). The top-level class is `Stompsocket`.

`@stomp/stompjs` is a **peer dependency** — install it yourself:

```bash
pnpm add @codejoo/stomp @stomp/stompjs
```

## Why

`@stomp/stompjs` reconnects the transport but does **not** restore your subscriptions. This wrapper adds the missing "product" layer on top:

- **Shared-parse callback queue** — multiple callbacks under the same `id` share one parsed payload (parsed once, dispatched to all); no duplicate `SUBSCRIBE`.
- **Three ways to unsubscribe** — the returned handle's `unsubscribe()` (ref-counted), `unsubscribe({ id | destination })`, and `clear()`.
- **Auto re-subscribe on reconnect** — replays local subscriptions in `onConnect`.
- **Offline send buffering** — `send()` while disconnected buffers and flushes on connect.
- **Ack modes** — `auto` (server acks, no client ack), `smart` (auto ACK on success / NACK on throw), `manual` (ack/nack via the `AckControl` passed to the callback, callable from outside).
- **Injectable binary decoder** — you decide how to decode binary frames.
- **Token refresh** — async `beforeConnect` returns fresh `connectHeaders` on every (re)connect.
- **Connection-state observation** — `state` getter + `onState(listener)` + `onStateChanged`.
- **Foreground-resume reconnect** — reconnects immediately on `visibilitychange`/`online` to sidestep Chromium background-tab timer throttling (stompjs #335/#669).
- **`copyWith`** and full passthrough of native `@stomp/stompjs` options.

## Usage

```ts
import { Stompsocket, AckMode } from "@codejoo/stomp";

const client = new Stompsocket({
  brokerURL: "wss://example.com/ws",
  beforeConnect: async () => ({ Authorization: `Bearer ${await getToken()}` }),
  onConnected: () => resyncSnapshot(), // re-fetch after any (re)connect
});

client.activate();

const sub = client.subscribe("/topic/quote", (json) => render(json));
// later
sub.unsubscribe();

client.send("/app/order", { body: { sku: "A", qty: 2 } }); // object → JSON

// manual ack — store the control and ack later, even outside the callback
client.subscribe("/queue/tasks", (json, ack) => queue(json, ack), { ack: AckMode.manual });

await client.dispose();
```

### Vue reactive state (bridge)

```ts
import { ref } from "vue";
const state = ref(client.state);
client.onState((s) => (state.value = s));
```

## License

MIT
