// PreToolUse(Edit|Write): allow only paths inside cwd and, when set, inside the lane's owned paths.
import { readFileSync } from "node:fs";
import { relative, resolve, isAbsolute } from "node:path";

type Event = { cwd: string; tool_input: { file_path?: string } };
const e = JSON.parse(readFileSync(0, "utf8")) as Event;

const target = resolve(e.cwd, e.tool_input.file_path ?? "");
const rel = relative(e.cwd, target);
const outside = rel.startsWith("..") || isAbsolute(rel);

// TODO: real glob matching (e.g. picomatch); resolve symlinks via realpathSync before the check.
const owned = (process.env.BAUHERR_LANE_OWNED_PATHS ?? "").split(":").filter(Boolean);
const inLane = owned.length === 0 || owned.some((p) => rel === p || rel.startsWith(p.replace(/\*+$/, "")));

const deny = outside ? "path outside the Run's cwd" : !inLane ? "path outside this lane's owned paths" : null;
process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: deny ? "deny" : "allow",
    permissionDecisionReason: deny ?? "in scope",
  },
}));
