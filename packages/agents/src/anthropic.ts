import Anthropic from "@anthropic-ai/sdk";
import type { AgentBundle } from "./orchestrator";

/** Minimal structural surface of the Anthropic client used here, so the
 *  orchestrator and unit tests can inject a fake without a real API key. */
export interface AnthropicLike {
  messages: {
    create(
      body: Anthropic.Messages.MessageCreateParamsNonStreaming,
    ): Promise<Anthropic.Messages.Message>;
  };
}

/** Model tiers for the three demo workers (sonnet for generation, a cheap tier
 *  for review). Override per call via `callAgent`'s `model`. */
export const MODELS = {
  codegen: "claude-sonnet-4-6",
  testwriter: "claude-sonnet-4-6",
  reviewer: "claude-haiku-4-5-20251001",
} as const;

export function makeAnthropic(
  apiKey: string | undefined = process.env.ANTHROPIC_API_KEY,
): Anthropic {
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required");
  return new Anthropic({ apiKey });
}

/** One agent turn. REQUIRED: the stable system prefix is sent with
 *  `cache_control: ephemeral` so the repeated demo runs hit the prompt cache. */
export async function callAgent(
  client: AnthropicLike,
  params: { system: string; prompt: string; model: string; maxTokens?: number },
): Promise<string> {
  const message = await client.messages.create({
    model: params.model,
    max_tokens: params.maxTokens ?? 2048,
    system: [{ type: "text", text: params.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: params.prompt }],
  });
  return message.content
    .filter((block): block is Anthropic.Messages.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}

/** Strip one wrapping ``` fence (with optional language tag) if present. */
export function stripFence(text: string): string {
  const fenced = text.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  return (fenced?.[1] ?? text).trim();
}

const CODEGEN_SYSTEM =
  "You are a senior engineer. Implement the requested function as a single ES module. " +
  "Respond with ONLY the module source — no prose, no markdown fences. Use `export function`.";

const TESTWRITER_SYSTEM =
  "You are a test engineer. Write Node.js tests (node:test + node:assert/strict) for the spec. " +
  'Import the implementation from "./solution.mjs". Respond with ONLY the test module source — ' +
  "no prose, no fences.";

const REVIEWER_SYSTEM =
  "You are a code reviewer. Given an implementation and its tests, give a concise review " +
  "(correctness, edge cases, style). Respond with the review text only.";

/** Agent 1: generate the implementation. */
export async function codegen(client: AnthropicLike, spec: string): Promise<string> {
  return stripFence(
    await callAgent(client, { system: CODEGEN_SYSTEM, prompt: spec, model: MODELS.codegen }),
  );
}

/** Agent 2: generate tests for the spec, importing `./solution.mjs`. */
export async function testwriter(client: AnthropicLike, spec: string): Promise<string> {
  return stripFence(
    await callAgent(client, { system: TESTWRITER_SYSTEM, prompt: spec, model: MODELS.testwriter }),
  );
}

/** Agent 3: review the implementation against its tests. */
export async function reviewer(
  client: AnthropicLike,
  code: string,
  tests: string,
): Promise<string> {
  return callAgent(client, {
    system: REVIEWER_SYSTEM,
    prompt: `Implementation:\n${code}\n\nTests:\n${tests}`,
    model: MODELS.reviewer,
  });
}

/** The real three-agent bundle wired to a live Anthropic client. No scenarios,
 *  no scripted outputs — each agent does its genuine job and the runner judges. */
export function makeAnthropicAgents(client: AnthropicLike): AgentBundle {
  return {
    codegen: (spec) => codegen(client, spec),
    testwriter: (spec) => testwriter(client, spec),
    reviewer: (code, tests) => reviewer(client, code, tests),
  };
}
