// Stop hook: the turn may end only if every Goal statement is verified or a blocker is declared.
// Input: Stop event JSON on stdin. Output: decision JSON on stdout.
import { readFileSync } from "node:fs";

type Statement = { text: string; status: "verified" | "blocked" | "unverified"; reason?: string };
type Decision = { decision?: "block"; reason?: string };

const event = JSON.parse(readFileSync(0, "utf8")) as { stop_hook_active?: boolean };
const goalFile = process.env.BAUHERR_GOAL_FILE;
if (!goalFile) throw new Error("BAUHERR_GOAL_FILE not set");

// TODO: re-verify evidence (test exit code, lint diff, MR exists via adapter) instead of trusting recorded status.
const goal = JSON.parse(readFileSync(goalFile, "utf8")) as Statement[];
const unmet = goal.filter((s) => s.status === "unverified");

let out: Decision = {};
// One re-prompt only: stop_hook_active means we already blocked once; the Runner then ends the Run needs_human.
if (unmet.length > 0 && !event.stop_hook_active) {
  out = {
    decision: "block",
    reason: `Unmet Goal statements: ${unmet.map((s) => s.text).join("; ")}. Verify each with evidence or declare a blocker (see run-contract).`,
  };
}
process.stdout.write(JSON.stringify(out));
