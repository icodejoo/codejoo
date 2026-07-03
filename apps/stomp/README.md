# @codejoo/stomp

Framework-agnostic STOMP-over-WebSocket client wrapper over [`@stomp/stompjs`](https://github.com/stomp-js/stompjs).

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
- **Auto ack/nack** — success → ACK, throwing callback → NACK; parse failure → configurable NACK (redeliver) or ACK (drop).
- **Injectable binary decoder** — you decide how to decode binary frames.
- **Token refresh** — async `beforeConnect` returns fresh `connectHeaders` on every (re)connect.
- **Connection-state observation** — `state` getter + `onState(listener)` + `onStateChanged`.
- **Foreground-resume reconnect** — reconnects immediately on `visibilitychange`/`online` to sidestep Chromium background-tab timer throttling (stompjs #335/#669).
- **`copyWith`** and full passthrough of native `@stomp/stompjs` options.

## Usage

```ts
import { SocketClient, AckMode } from "@codejoo/stomp";

const client = new SocketClient({
  brokerURL: "wss://example.com/ws",
  beforeConnect: async () => ({ Authorization: `Bearer ${await getToken()}` }),
  onConnected: () => resyncSnapshot(), // re-fetch after any (re)connect
});

client.activate();

const sub = client.subscribe("/topic/quote", (json) => render(json));
// later
sub.unsubscribe();

client.send("/app/order", { body: { sku: "A", qty: 2 } }); // object → JSON

// manual ack/nack per message
client.subscribe("/queue/tasks", handle, { ack: AckMode.clientIndividual });

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
