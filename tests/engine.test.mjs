import assert from "node:assert/strict";
import test from "node:test";
import { evidenceDebt, evaluateScenario, scenarios } from "../lib/faultline-engine.ts";

test("the same rules identify the bad deployment scenario", () => {
  const result = evaluateScenario(scenarios.find(s => s.id === "bad-deployment"));
  assert.equal(result[0].id, "deployment");
  assert.equal(result[0].status, "Supported");
  assert.equal(result.find(c => c.id === "traffic").status, "Contradicted");
});

test("the same rules identify a traffic surge", () => {
  const result = evaluateScenario(scenarios.find(s => s.id === "traffic-surge"));
  assert.equal(result[0].id, "traffic");
  assert.equal(result[0].status, "Supported");
});

test("the same rules identify a shared dependency failure", () => {
  const result = evaluateScenario(scenarios.find(s => s.id === "dependency-failure"));
  assert.equal(result[0].id, "dependency");
  assert.equal(result[0].status, "Supported");
});

test("missing required signals become evidence debt", () => {
  const debt = evidenceDebt(scenarios[0]);
  assert.ok(debt.some(item => item.signal === "dependency_errors"));
  assert.ok(debt.some(item => item.signal === "scale_recovery"));
});
