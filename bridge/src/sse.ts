// Minimal SSE client over fetch, reconnects forever. Only "message" events
// matter to the bridge. After a reconnect, messages posted while the stream
// was down are replayed from the hub's inbox, so a mention is never lost.
//
// Replay goes by message id, not by time: the laptop's clock and the hub's
// clock disagree, and a fast laptop clock would silently drop messages.
export interface HubMessage {
  id: string;
  roomId: string;
  from: string;
  kind: string;
  text: string;
  mentions: string[];
  mentionsRoom: boolean;
  at: string;
}

export interface SubscribeOptions {
  signal?: AbortSignal; // stops the loop (tests)
  retryMs?: number;
}

const SEEN_MAX = 1000;

export async function subscribe(
  hub: string,
  token: string,
  onMessage: (m: HubMessage) => void | Promise<void>,
  { signal, retryMs = 1000 }: SubscribeOptions = {},
) {
  const auth = { Authorization: `Bearer ${token}` };
  const inbox = (query: string): Promise<HubMessage[]> =>
    fetch(`${hub}/api/inbox${query}`, { headers: auth, signal }).then((r) => {
      if (!r.ok) throw new Error(`inbox answered ${r.status}`);
      return r.json();
    });
  let lastId: string | undefined; // newest message the bridge knows about
  let primed = false;
  const seen = new Set<string>(); // replay and live stream can overlap
  // Delivery runs outside the read loop: an agent turn can take minutes and
  // must not stall the stream. The exec adapter keeps its own queue for order.
  const handle = (m: HubMessage) => {
    if (seen.has(m.id)) return;
    seen.add(m.id);
    if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value!);
    lastId = m.id;
    void Promise.resolve(onMessage(m)).catch((e) => console.error(`warren-bridge: delivery failed: ${(e as Error).message}`));
  };

  while (!signal?.aborted) {
    try {
      const res = await fetch(`${hub}/api/events?mentions=1`, { headers: { ...auth, Accept: "text/event-stream" }, signal });
      if (!res.ok || !res.body) throw new Error(`hub answered ${res.status}`);
      if (!primed) {
        // History from before the bridge started is not delivered; it only sets the cursor.
        lastId = (await inbox("?all=1")).at(-1)?.id;
        primed = true;
      } else {
        for (const m of await inbox(lastId ? `?since=${encodeURIComponent(lastId)}` : "")) handle(m);
      }
      const decoder = new TextDecoder();
      let buffer = "";
      for await (const chunk of res.body) {
        buffer += decoder.decode(chunk as Uint8Array, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const event = frame.match(/^event: (.*)$/m)?.[1];
          const data = frame.match(/^data: (.*)$/m)?.[1];
          if (event !== "message" || !data) continue;
          handle(JSON.parse(data));
        }
      }
    } catch (e) {
      if (signal?.aborted) return;
      // stderr only: stdout belongs to the MCP stdio transport
      console.error(`warren-bridge: ${(e as Error).message}, reconnecting`);
    }
    await new Promise((r) => setTimeout(r, retryMs));
  }
}
