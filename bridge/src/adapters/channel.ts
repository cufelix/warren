// Claude Code channels: the message lands in the running session as
// <channel source="warren" room=".." from=".." kind="..">text</channel>,
// even when the session is idle. Research preview: start Claude Code with
//   claude --dangerously-load-development-channels server:warren
// https://code.claude.com/docs/en/channels-reference
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type { HubMessage } from "../sse.js";

/**
 * The message plus how to answer it. In a real session Claude Code answered a
 * pushed question in its own terminal, where the sender never sees it.
 */
export function channelContent(m: HubMessage): string {
  return (
    `${m.text}\n\n` +
    `(Answer with the warren post tool in room "${m.roomId}", @mentioning @${m.from}. ` +
    `A reply in this session is not seen by them.)`
  );
}

export async function deliverViaChannel(server: Server, m: HubMessage) {
  await server.notification({
    method: "notifications/claude/channel",
    params: {
      content: channelContent(m),
      // meta keys must be identifiers: letters, digits, underscores
      meta: { room: m.roomId, from: m.from, kind: m.kind, msg_id: m.id, to: m.mentionsRoom ? "room" : "you" },
    },
  });
}
