import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, test, vi } from "vitest";
import { type AnthropicLike, callAgent, codegen, MODELS } from "../src/anthropic.js";

type CreateBody = Anthropic.Messages.MessageCreateParamsNonStreaming;
type SystemBlocks = Anthropic.Messages.TextBlockParam[];

function mockClient(text: string) {
  const create = vi.fn(
    async (_body: CreateBody) =>
      ({ content: [{ type: "text", text }] }) as unknown as Anthropic.Messages.Message,
  );
  const client = { messages: { create } } as unknown as AnthropicLike;
  return { client, create };
}

describe("callAgent", () => {
  test("sends the system prefix with ephemeral cache_control (required caching)", async () => {
    const { client, create } = mockClient("ok");
    await callAgent(client, { system: "SYS", prompt: "P", model: "m" });

    const body = create.mock.calls[0]?.[0];
    const system = body?.system as SystemBlocks;
    expect(system[0]?.cache_control).toEqual({ type: "ephemeral" });
    expect(system[0]?.text).toBe("SYS");
    expect(body?.model).toBe("m");
    expect(body?.messages[0]).toEqual({ role: "user", content: "P" });
  });

  test("concatenates and trims the returned text blocks", async () => {
    const { client } = mockClient("  hello  ");
    expect(await callAgent(client, { system: "s", prompt: "p", model: "m" })).toBe("hello");
  });
});

describe("codegen", () => {
  test("strips markdown fences and uses the codegen model", async () => {
    const { client, create } = mockClient("```js\nexport const x = 1;\n```");
    const out = await codegen(client, "make x");
    expect(out).toBe("export const x = 1;");
    expect(create.mock.calls[0]?.[0].model).toBe(MODELS.codegen);
  });
});
