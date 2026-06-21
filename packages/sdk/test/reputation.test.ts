import { describe, expect, test } from "vitest";
import { parseAgentRecordObject } from "../src/reputation.js";

describe("parseAgentRecordObject", () => {
  test("parses a dynamic-field record object", () => {
    const record = parseAgentRecordObject("0xa1", {
      data: {
        content: {
          dataType: "moveObject",
          fields: {
            value: {
              fields: {
                jobs_settled: "2",
                total_earned: "150",
                last_settled_epoch: "7",
                counterparties: { fields: { contents: ["0xa2", "0xa3"] } },
              },
            },
          },
        },
      },
    });

    expect(record).toEqual({
      agent: "0xa1",
      jobsSettled: 2,
      totalEarned: 150n,
      lastSettledEpoch: 7n,
      counterparties: ["0xa2", "0xa3"],
    });
  });

  test("returns null when the dynamic field is missing", () => {
    expect(
      parseAgentRecordObject("0xa1", {
        error: { code: "dynamicFieldNotFound", object_id: "0xregistry" },
      }),
    ).toBeNull();
  });
});
