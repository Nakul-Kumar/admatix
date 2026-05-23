import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  Guardrails,
  PolicyDecision,
  PolicyRule,
  ProposedAction,
  type Campaign,
  type NormalizedMetrics,
  type RiskLevel,
} from "@admatix/schemas";

export interface PolicyContext {
  campaign?: Campaign;
  metrics?: NormalizedMetrics;
  guardrails: Guardrails;
}

const PolicyFile = z.object({
  version: z.string().min(1),
  rules: z.array(PolicyRule),
});

const DEFAULT_POLICY_VERSION = "v1";
const DEFAULT_BUDGET_CAP_PCT = 25;

const SPEND_TOUCHING_FALLBACK = new Set<string>([
  "budget_shift",
  "bid_adjust",
  "pause_entity",
  "resume_entity",
  "creative_rotate",
  "add_negative_keyword",
]);

function policyPath(version: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "policy", `policy.${version}.json`);
}

const policyCache = new Map<string, { version: string; rules: PolicyRule[] }>();

export function loadPolicy(version?: string): { version: string; rules: PolicyRule[] } {
  const v = version ?? DEFAULT_POLICY_VERSION;
  const cached = policyCache.get(v);
  if (cached) return cached;
  let raw: string;
  try {
    raw = readFileSync(policyPath(v), "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to load policy version "${v}" from ${policyPath(v)}: ${(err as Error).message}. ` +
        `Add packages/policy/policy/policy.${v}.json or pass a known version.`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `Policy file policy.${v}.json is not valid JSON: ${(err as Error).message}`,
    );
  }
  const parsed = PolicyFile.parse(json);
  policyCache.set(v, parsed);
  return parsed;
}

function decisionId(): string {
  return `dec_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function blockedDecision(
  action_id: string,
  policy_version: string,
  matched_rules: string[],
  reasons: string[],
  risk_level: RiskLevel = "high",
): PolicyDecision {
  return PolicyDecision.parse({
    decision_id: decisionId(),
    action_id,
    policy_version,
    result: "block",
    matched_rules,
    reasons,
    risk_level,
    decided_at: new Date().toISOString(),
  });
}

function numericParam(
  params: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = params[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function stringListParam(
  params: Record<string, unknown>,
  key: string,
): Set<string> | undefined {
  const v = params[key];
  if (!Array.isArray(v)) return undefined;
  const list: string[] = [];
  for (const item of v) {
    if (typeof item === "string") list.push(item);
  }
  return list.length > 0 ? new Set(list) : undefined;
}

function safeActionId(action: unknown): string {
  if (action && typeof action === "object") {
    const id = (action as { action_id?: unknown }).action_id;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return "unknown";
}

/**
 * @internal — exported only for the exhaustiveness test (QA finding #12).
 * Production callers use `evaluateAction` which loads the on-disk policy.
 */
export function evaluateActionAgainstRules(
  action: ProposedAction,
  ctx: PolicyContext,
  policy: { version: string; rules: PolicyRule[] },
): PolicyDecision {
  return evaluateActionInner(action, ctx, policy);
}

export function evaluateAction(action: ProposedAction, ctx: PolicyContext): PolicyDecision {
  let policy: { version: string; rules: PolicyRule[] };
  try {
    policy = loadPolicy();
  } catch (err) {
    return blockedDecision(
      safeActionId(action),
      "unknown",
      ["policy_load_failed"],
      [`Could not load policy: ${(err as Error).message}`],
    );
  }
  return evaluateActionInner(action, ctx, policy);
}

function evaluateActionInner(
  action: ProposedAction,
  ctx: PolicyContext,
  policy: { version: string; rules: PolicyRule[] },
): PolicyDecision {
  const policy_version = policy.version;
  const action_id_for_failure = safeActionId(action);

  const actionParse = ProposedAction.safeParse(action);
  if (!actionParse.success) {
    const reasons = actionParse.error.issues.map((i) => {
      const path = i.path.length > 0 ? i.path.join(".") : "<root>";
      return `${path}: ${i.message}`;
    });
    return blockedDecision(
      action_id_for_failure,
      policy_version,
      ["prohibited_action_v1"],
      [
        `Action failed schema validation; fail-closed block. Issues: ${reasons.join("; ")}`,
      ],
    );
  }
  const a = actionParse.data;

  if (!ctx || typeof ctx !== "object") {
    return blockedDecision(
      a.action_id,
      policy_version,
      ["prohibited_action_v1"],
      ["PolicyContext is missing; cannot evaluate without guardrails."],
    );
  }
  const guardParse = Guardrails.safeParse(ctx.guardrails);
  if (!guardParse.success) {
    return blockedDecision(
      a.action_id,
      policy_version,
      ["prohibited_action_v1"],
      [
        `Guardrails missing or invalid: ${guardParse.error.issues
          .map((i) => i.message)
          .join("; ")}`,
      ],
    );
  }
  const guardrails = guardParse.data;

  const matched: string[] = [];
  const reasons: string[] = [];
  let blocked = false;

  for (const rule of policy.rules) {
    switch (rule.kind) {
      case "prohibited_action": {
        if (a.dry_run_only !== true) {
          matched.push(rule.rule_id);
          reasons.push(
            `Action is not a dry-run; live writes are prohibited (rule ${rule.rule_id}).`,
          );
          if (rule.severity === "block") blocked = true;
        }
        break;
      }
      case "budget_cap": {
        if (a.type !== "budget_shift") break;
        const cap =
          guardrails.max_daily_budget_delta_pct ??
          numericParam(rule.params, "max_daily_budget_delta_pct") ??
          DEFAULT_BUDGET_CAP_PCT;
        const deltaPctRaw = a.params["delta_pct"];
        if (typeof deltaPctRaw !== "number" || !Number.isFinite(deltaPctRaw)) {
          matched.push(rule.rule_id);
          reasons.push(
            `budget_shift action ${a.action_id} is missing a numeric params.delta_pct; ` +
              `cannot verify the ${cap}% cap (rule ${rule.rule_id}).`,
          );
          if (rule.severity === "block") blocked = true;
          break;
        }
        if (Math.abs(deltaPctRaw) > cap) {
          matched.push(rule.rule_id);
          reasons.push(
            `budget_shift |${deltaPctRaw}%| exceeds the ${cap}% cap (rule ${rule.rule_id}).`,
          );
          if (rule.severity === "block") blocked = true;
        }
        break;
      }
      case "approval_required": {
        const list = stringListParam(rule.params, "spend_touching_actions") ??
          SPEND_TOUCHING_FALLBACK;
        if (list.has(a.type)) {
          matched.push(rule.rule_id);
          reasons.push(
            `Action type ${a.type} is spend-touching; human approval required ` +
              `(rule ${rule.rule_id}).`,
          );
        }
        break;
      }
      case "brand_safety":
      case "platform_limit":
        // Recognised but not enforced by the MVP rules engine. Listing
        // them explicitly satisfies the exhaustiveness check below.
        break;
      default: {
        // Fail-closed exhaustiveness check (QA finding #12 / AGENTS.md §6).
        // A new PolicyRule.kind must be wired here; the rule cannot
        // silently become a no-op. The cast lets the compiler narrow
        // `rule.kind` to `never` when every case is covered.
        const exhaustive: never = rule.kind as never;
        matched.push("policy_kind_unhandled");
        reasons.push(
          `policy_kind_unhandled:${String(exhaustive)} (rule ${rule.rule_id}). ` +
            "PolicyGuard fails closed for unknown rule kinds.",
        );
        blocked = true;
        break;
      }
    }
  }

  let result: PolicyDecision["result"];
  if (blocked) result = "block";
  else if (matched.length > 0) result = "needs_approval";
  else result = "allow";

  const risk_level: RiskLevel = blocked ? "high" : a.risk_level;

  return PolicyDecision.parse({
    decision_id: decisionId(),
    action_id: a.action_id,
    policy_version,
    result,
    matched_rules: matched,
    reasons,
    risk_level,
    decided_at: new Date().toISOString(),
  });
}
