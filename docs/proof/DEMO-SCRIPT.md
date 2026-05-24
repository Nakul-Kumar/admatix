# AdMatix Phase 5 Demo Script

Target length: 4 to 6 minutes
Format: one terminal pane plus the proof dashboard at `https://admatix.tech`
Boundary: dry-run proof sequence only; no live ad-platform mutation

## Recording Setup

From a fresh checkout:

```powershell
pnpm install --frozen-lockfile
pnpm exec vitest run tests/e2e/demo-flow.test.ts
pnpm demo
```

For the dashboard:

```powershell
cd proof-dashboard
npm ci
npm run validate:origin
npm run build
```

Open:

- `https://admatix.tech`
- `https://admatix.tech/artifacts`
- Optional illustrative pages only after saying they are demo samples:
  `/overview`, `/worlds`, `/benchmark`, `/validation`, `/decisions`

## Narration

### 1. What AdMatix Is

"AdMatix is an evidence-gated control plane for AI-run paid media. The agent can
propose a change, but deterministic gates and an independent verifier decide
what can proceed. This demo is dry-run only. We are not claiming live spend lift."

### 2. Audit

Run `pnpm demo` and pause on step 1.

"The demo starts with an audit over fixture account data. AdMatix finds issues
that an agent might want to act on, but no mutation happens from the audit."

### 3. Plan and H0 Packets

Pause on the planning/H0 packet lines.

"The plan step converts findings into H0 packets. Each packet carries evidence
metadata, so a proposed change has a falsifiable measurement target instead of a
vague optimization claim."

### 4. Dry-Run Activation

Pause on the dry-run diff.

"The activation path is intentionally a dry run. AdMatix returns a diff showing
what would change. It does not send a mutation to an ad platform."

### 5. Unsafe Variant Blocked

Pause on the PolicyGuard block.

"Now the unsafe variant is attempted. The policy guard blocks it before it can
touch spend. This is the core control-plane behavior: agents propose; deterministic
code gates spend-touching actions."

### 6. Benchmark and MCP Surface

Pause on benchmark and MCP lines.

"The demo then runs the benchmark surface and checks the MCP read-only tool
boundary. The MCP path lets an agent inspect evidence, but not bypass activation
policy."

### 7. Dashboard Artifact View

Switch to `https://admatix.tech` or `/artifacts`.

"The public dashboard opens on the artifact-backed proof view. These cards read
aggregate outputs from the accepted CX-2 validation, CX-3 head-to-head benchmark,
and CX-4 public RCT backtests. The visible claim boundary is deliberate: this is
calibrated simulator plus public RCT/backtest evidence, not live spend lift."

### 8. Close

"The full loop is: propose, gate, log, verify, and show the proof trail with
claim limits attached. AdMatix does not claim certainty it does not have. It
blocks unsafe actions, measures supported designs, and labels weak evidence
honestly."

## On-Screen Evidence Checklist

- Demo terminal ends with `Demo complete - 8/8 steps green`.
- The blocked unsafe action is visible in the terminal transcript.
- `/artifacts` shows `origin.kind = artifact` evidence for CX-2, CX-3, and CX-4.
- Any non-artifact dashboard page is labeled as illustrative demo data.
- No statement in the recording says or implies proven live spend lift.
