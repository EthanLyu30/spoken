import { describe, expect, it } from "vitest";
import type { ChatMessage } from "./api";
import {
  appendUserTurn,
  previousPartnerMessage,
  type UserTurnMetaMap,
} from "./conversationTurns";

describe("appendUserTurn", () => {
  it("keeps chat messages text-only while storing mixed-input audio in memory metadata", () => {
    const pcm = new ArrayBuffer(8);
    const result = appendUserTurn([], {}, "I want a coffee", {
      source: "mixed",
      spokenText: "I want",
      pcm,
    });

    expect(result.messages).toEqual([{ role: "user", content: "I want a coffee" }]);
    expect(result.messages[0]).not.toHaveProperty("pcm");
    expect(result.meta[result.index]).toEqual({
      source: "mixed",
      spokenText: "I want",
      pcm,
    });
  });

  it("retains PCM for only the newest eight user turns", () => {
    let messages: ChatMessage[] = [];
    let meta: UserTurnMetaMap = {};

    for (let turn = 0; turn < 10; turn += 1) {
      const result = appendUserTurn(messages, meta, `turn ${turn}`, {
        source: "voice",
        spokenText: `turn ${turn}`,
        pcm: new ArrayBuffer(turn + 1),
      });
      messages = result.messages;
      meta = result.meta;
    }

    expect(meta[0]?.pcm).toBeUndefined();
    expect(meta[1]?.pcm).toBeUndefined();
    expect(meta[2]?.pcm).toBeInstanceOf(ArrayBuffer);
    expect(meta[9]?.pcm).toBeInstanceOf(ArrayBuffer);
    expect(Object.values(meta).filter((item) => item.pcm).length).toBe(8);
    expect(meta[0]).toMatchObject({ source: "voice", spokenText: "turn 0" });
  });
});

describe("previousPartnerMessage", () => {
  it("finds the closest preceding assistant turn", () => {
    const messages: ChatMessage[] = [
      { role: "assistant", content: "What can I get you?" },
      { role: "user", content: "A coffee." },
      { role: "assistant", content: "What size?" },
      { role: "user", content: "A big one." },
    ];

    expect(previousPartnerMessage(messages, 3)).toBe("What size?");
    expect(previousPartnerMessage(messages, 0)).toBeUndefined();
  });
});
