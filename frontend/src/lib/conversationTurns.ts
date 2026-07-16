import type { ChatMessage } from "./api";

export type UserTurnSource = "typed" | "voice" | "mixed";

export interface UserTurnMeta {
  source: UserTurnSource;
  spokenText?: string;
  pcm?: ArrayBuffer;
}

export type UserTurnMetaMap = Record<number, UserTurnMeta>;

const MAX_PCM_TURNS = 8;

export interface AppendedUserTurn {
  messages: ChatMessage[];
  meta: UserTurnMetaMap;
  index: number;
}

export function appendUserTurn(
  messages: ChatMessage[],
  currentMeta: UserTurnMetaMap,
  text: string,
  turnMeta: UserTurnMeta,
): AppendedUserTurn {
  const index = messages.length;
  const nextMeta: UserTurnMetaMap = {
    ...currentMeta,
    [index]: { ...turnMeta },
  };

  const pcmIndexes = Object.entries(nextMeta)
    .filter(([, item]) => item.pcm)
    .map(([key]) => Number(key))
    .sort((a, b) => a - b);

  for (const staleIndex of pcmIndexes.slice(0, -MAX_PCM_TURNS)) {
    const { pcm: _pcm, ...retainedMeta } = nextMeta[staleIndex];
    nextMeta[staleIndex] = retainedMeta;
  }

  return {
    messages: [...messages, { role: "user", content: text }],
    meta: nextMeta,
    index,
  };
}

export function previousPartnerMessage(
  messages: ChatMessage[],
  userIndex: number,
): string | undefined {
  for (let index = userIndex - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role === "assistant") return message.content;
  }
  return undefined;
}
