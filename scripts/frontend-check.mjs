import assert from "node:assert/strict";
import {
  decodeTaskView,
  deriveBoardPhase,
  signalCounts,
  signalIdentityKeys,
} from "../src/lib/frontend/delegate/model.ts";

const task = {
  id: "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  prompt: "Pick one",
  response_type: "choice",
  options: ["A", "B"],
  status: "open",
  responses_count: 4,
  budget_cents: 500,
  created_at: "2026-10-03T12:00:00.000Z",
};
const decoded = decodeTaskView(task);
assert.ok(decoded, "valid TaskView decodes");
assert.equal(decodeTaskView({ ...task, status: "settled" }), null, "unknown task status is rejected");

const snapshot = {
  task: decoded,
  signalsLoaded: true,
  receipt: null,
  signals: [
    { id: "1", answer: "A", name: "Maya", status: "pending", reason: null, createdAt: "1" },
    { id: "2", answer: "A", name: "Raj", status: "accepted", reason: null, createdAt: "2" },
    { id: "3", answer: "A", name: "Ana", status: "accepted", reason: null, createdAt: "3" },
    { id: "4", answer: "invalid", name: "Bot", status: "rejected", reason: "not a valid option", createdAt: "4" },
  ],
};
assert.deepEqual(signalCounts(snapshot), { submitted: 4, verified: 2, screening: 1, rejected: 1 });
assert.equal(signalCounts({ ...snapshot, signalsLoaded: false }), null, "unloaded signals have no breakdown");
assert.equal(
  signalCounts({ ...snapshot, task: { ...decoded, responses_count: 5 } }),
  null,
  "signal breakdown waits for task count reconciliation",
);

const duplicate = { ...snapshot.signals[0], createdAt: "same-time" };
const duplicateKeys = signalIdentityKeys([duplicate, { ...duplicate }]);
assert.equal(new Set(duplicateKeys).size, 2, "identical genuine submissions retain distinct identities");
assert.deepEqual(duplicateKeys, signalIdentityKeys([duplicate, { ...duplicate }]), "identities survive full replacement");

assert.equal(deriveBoardPhase({ ...snapshot, task: { ...decoded, status: "open", responses_count: 0 } }, "live"), "connecting");
assert.equal(deriveBoardPhase(snapshot, "live"), "listening");
assert.equal(deriveBoardPhase({ ...snapshot, task: { ...decoded, status: "closing" } }, "offline"), "weaving");
const result = {
  summary: "Two signals verified.",
  winner: "A",
  tally: { A: 2 },
  responses: [],
  rejected: 1,
  paid: { total_cents: 0, per_human_cents: 0, stripe: "pi_example" },
};
assert.deepEqual(
  signalCounts({
    ...snapshot,
    signalsLoaded: false,
    task: {
      ...decoded,
      status: "closed",
      result: { ...result, responses: [{ answer: "A", name: "Maya" }, { answer: "A", name: "Raj" }] },
    },
  }),
  { submitted: 4, verified: 2, screening: 0, rejected: 1 },
  "closed result overrides unavailable historical signal rows",
);
assert.equal(
  decodeTaskView({ ...task, status: "closed", result: { ...result, tally: { A: 1.5 } } }),
  null,
  "tally counts must be nonnegative integers",
);
assert.equal(deriveBoardPhase({ ...snapshot, task: { ...decoded, status: "closed", result } }, "offline"), "breathing");
assert.equal(deriveBoardPhase({ ...snapshot, task: { ...decoded, status: "closed" } }, "live"), "closed");

console.log("Frontend delegate model checks passed.");
