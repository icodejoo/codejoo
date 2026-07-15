# @codejoo/stomp

> 中文文档见 [README.zh-CN.md](./README.zh-CN.md)（含完整 API 说明）。

Framework-agnostic STOMP-over-WebSocket client wrapper over [`@stomp/stompjs`](https://github.com/stomp-js/stompjs). The top-level class is `Stompsocket`.

`@stomp/stompjs` is a **peer dependency** — install it yourself:

```bash
pnpm add @codejoo/stomp @stomp/stompjs
```

## Why

`@stomp/stompjs` reconnects the transport but does **not** restore your subscriptions. This wrapper adds the missing "product" layer on top:

- **Automatic deduplication by destination** — multiple `subscribe()` calls to the same destination (with the same options, no `id` given) share one wire `SUBSCRIBE`, one parse, one reference. Ref-counted: the last unsubscribe sends `UNSUBSCRIBE`.
- **Three ways to unsubscribe** — the returned handle's `unsubscribe()` (ref-counted), `unsubscribe({ id | destination })`, and `clear()`.
- **Auto re-subscribe on reconnect** — replays local subscriptions in `onConnect`.
- **Offline send buffering** — `send()` while disconnected buffers and flushes on connect.
- **Ack modes** — `auto` (server acks, no client ack), `smart` (auto ACK on success / NACK on throw), `manual` (ack/nack via the `AckControl` passed to the callback, callable from outside).
- **Injectable binary decoder** — you decide how to decode binary frames.
- **Tolerant body parsing** — a callback gets whatever `JSON.parse` produces (object, array, string, number, boolean, `null`); only a genuine `JSON.parse` failure falls back to the raw text, so a plain-string body never gets silently dropped.
- **Token refresh** — async `beforeConnect` returns fresh `connectHeaders` on every (re)connect.
- **Exponential-backoff reconnect** — `reconnectTimeMode: "exponential"` + `maxReconnectDelay` (passthrough to stompjs 7.1+).
- **Parse-failure observability** — `onParseFailure` fires when a message body can't be decoded (undecodable binary), which would otherwise be dropped silently in `auto` mode.
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
