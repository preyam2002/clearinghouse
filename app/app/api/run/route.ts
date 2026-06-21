import { makeAnthropic, makeAnthropicAgents } from "@clearinghouse/agents/anthropic";
import { runJob, withInjectedFault } from "@clearinghouse/agents/orchestrator";
import { toHex } from "@mysten/sui/utils";
import { NextResponse } from "next/server";

// The agents call out to Anthropic and the runner spawns a `node --test`
// subprocess, so this must run on the Node.js runtime, never the Edge runtime.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

interface RunBody {
  spec?: unknown;
  payees?: unknown;
  fault?: unknown;
}

function isAddressTriple(value: unknown): value is [string, string, string] {
  return (
    Array.isArray(value) &&
    value.length === 3 &&
    value.every((p) => typeof p === "string" && p.startsWith("0x"))
  );
}

/**
 * Run the real off-chain pipeline for one job: three live Anthropic agents
 * (code-gen, test-writer, reviewer) produce the deliverables, the sandboxed
 * runner executes the delivered tests against the delivered code, and the
 * predicate proof is built from the genuine verdict. Returns the artifacts,
 * the runner transcript, and the deliveries + proof the browser needs to build
 * and sign the settle PTB. No fixtures, no manual pass/fail.
 */
export async function POST(req: Request) {
  let body: RunBody;
  try {
    body = (await req.json()) as RunBody;
  } catch {
    return NextResponse.json({ error: "request body must be JSON" }, { status: 400 });
  }

  const { spec, payees, fault } = body;
  if (typeof spec !== "string" || !spec.trim()) {
    return NextResponse.json({ error: "spec is required" }, { status: 400 });
  }
  if (!isAddressTriple(payees)) {
    return NextResponse.json(
      { error: "payees must be three 0x addresses (code-gen, test-writer, reviewer)" },
      { status: 400 },
    );
  }

  let client: ReturnType<typeof makeAnthropic>;
  try {
    client = makeAnthropic();
  } catch {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server" },
      { status: 503 },
    );
  }

  const base = makeAnthropicAgents(client);
  const agents = fault === true ? withInjectedFault(base) : base;

  try {
    const result = await runJob({
      spec,
      payees: { codegen: payees[0], testwriter: payees[1], reviewer: payees[2] },
      agents,
    });
    return NextResponse.json({
      passed: result.passed,
      transcript: result.transcript,
      proof: toHex(result.proof),
      deliveries: result.deliveries.map((d) => ({
        agent: d.agent,
        deliverable: toHex(d.deliverable),
      })),
      artifacts: result.artifacts,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
