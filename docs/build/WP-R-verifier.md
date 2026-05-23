# WP-R — Independent verification engine (`services/verifier`)

**Owns:** `services/verifier/**`, `docs/runbooks/verifier.md`
**Branch:** `wp/r-verifier` · **Phase:** 3 · **Wave:** 2
**Depends on:** WP-P (`services/ingest`) and WP-Q (`services/simulator`) merged
  on `main` (delivered via the parallel `codex/sim-readiness` track).
**Suggested agent:** Claude Code Opus 4.7 · **Size:** large

## Why this exists

The verifier is the independent grader that turns AdMatix from "a governed
workflow" into "a thing that can prove it works." It is a separate FastAPI
process — never the agent that proposed the action — and given an H0 packet plus
the post-period data window it returns `{estimate, ci_low, ci_high, method,
causal_status, verdict, confounders}`. It is the engine the Phase 3 gate is
written against, and it is independent of WP-S: WP-R must boot, expose `/verify`
over HTTP, and recover the simulator's hidden ground truth on its own, before
WP-S wires any agent to it.

## Required reading (in this order)

1. `docs/architecture/PROOF-WAVE-MASTER-PLAN.md` §6.2 — the verifier's mandate,
   the five methods, the contract that it **never** returns a bare per-decision
   causal lift number, and the `inconclusive` first-class verdict.
2. `docs/architecture/SIMULATION-VERIFICATION.md` §2 (verifier methods + FastAPI
   surface), §4 (the pinned Python stack — `tfp-causalimpact` / `tfcausalimpact`
   for BSTS, `econml` + `causalml` for CATE, `statsmodels` + `econml` for
   geo-holdout + power/MDE, `obp` for OPE).
3. `docs/architecture/SIMULATION-VERIFICATION.md` §1 — what the simulator emits
   and how ground truth is structured (the verifier is judged against
   `metadata.json#ground_truth.ate` and the per-row `tau` column).
4. `docs/architecture/ARCHITECTURE-DEEP.md` §6 (where `MeasurementScientistAgent`
   sits — WP-S, not WP-R, wires the agent to this service) and §9 (causal-lift
   discipline).
5. `docs/build/AUTONOMOUS-WAVE-PLAN.md` Phase 3 row — the WP-R one-line scope
   and the Phase 3 gate.
6. `docs/phase-reports/codex-sim-readiness.md` — what `services/ingest` and
   `services/simulator` already provide: `WorldType ∈ {clean_ab,
   geo_structured, confounded, zero_lift_placebo}`, CSV output at
   `<world_dir>/events.csv` with columns
   `user_id,period,geo_id,age_band,device,recency,frequency,prior_conversions,baseline_propensity,treatment,outcome,revenue,tau`,
   metadata at `<world_dir>/metadata.json` carrying
   `ground_truth.{ate, att, true_incremental_lift, seasonality_curve,
   confounder_coefficients, geo_count, geo_random_effect_sd}`. Data URIs are
   local `file://` paths.
7. `services/simulator/src/admatix_simulator/__init__.py` — the
   `SimulationConfig`, `generate_world(config, output_dir)`, and `naive_lift`
   API the verifier's tests will call directly (no HTTP hop needed for unit
   tests).
8. `packages/schemas/src/h0-packet.ts` and `packages/schemas/src/proposed-action.ts`
   (read-only) — the canonical H0 packet shape WP-R must accept and validate
   as JSON. WP-R defines a **read-only Pydantic mirror** of the subset of
   fields it needs; it does not redefine the contract.
9. `AGENTS.md` — the ten golden rules. The two that bind WP-R: (4) every claim
   carries source refs; (9) no secrets committed, no raw PII to LLMs (the
   verifier has zero LLM calls).

## Public surface

The build agent implements **exactly** the signatures below. These are the
contract WP-S consumes.

### FastAPI surface (`services/verifier/src/admatix_verifier/app.py`)

```python
app = FastAPI(title="admatix-verifier", version="0.1.0")

@app.get("/healthz")
def healthz() -> HealthResponse: ...
    # → { "status": "ok", "version": "<git-sha or 0.1.0>",
    #     "libs": { "econml": "...", "causalml": "...", "obp": "...",
    #               "statsmodels": "...", "tfcausalimpact": "..." } }

@app.post("/verify")
def verify(req: VerifyRequest) -> VerifyResponse: ...

@app.post("/simulate")
def simulate(req: SimulateRequest) -> SimulateResponse: ...
    # Thin wrapper around services.simulator.generate_world — included so
    # WP-S integration tests can spin up a world purely through the HTTP
    # surface. Reads & writes only under data/sim/.
```

### Pydantic models (`services/verifier/src/admatix_verifier/models.py`)

```python
class H0PacketSubset(BaseModel):
    packet_id: str
    tenant_id: str
    account_ref: str
    goal: str
    hypothesis: str
    causal_status: Literal["heuristic", "directional_until_lift_test",
                           "experimental", "causal"]
    guardrails: dict[str, Any]          # budget_cap, freq_cap, pacing_bounds, ...
    evidence_refs: list[str]            # opaque ref strings — passed through

class VerifyRequest(BaseModel):
    packet: H0PacketSubset
    data_uri: str                       # file://<absolute path to events.csv>
    metadata_uri: str | None = None     # file://<...metadata.json> if known
    action_log_uri: str | None = None   # JSONL of executed actions (for guardrail proof)
    hint: dict[str, Any] | None = None  # { "design": "clean_ab"|"geo_holdout"|... }

class GuardrailRuleResult(BaseModel):
    rule_id: str
    predicate: str
    inputs: dict[str, Any]
    pass_: bool = Field(alias="pass")

class GuardrailProof(BaseModel):
    all_pass: bool
    rules: list[GuardrailRuleResult]

class VerifyResponse(BaseModel):
    # The seven canonical fields from PROOF-WAVE-MASTER-PLAN §6.2:
    estimate: float | None              # null only when method = "guardrail_only"
    ci_low: float | None
    ci_high: float | None
    method: Literal["guardrail_only", "bsts_synthetic_control",
                    "cate_meta_learner", "geo_synthetic_control",
                    "ope_ips_snips_dr"]
    causal_status: Literal["heuristic", "directional_until_lift_test",
                           "experimental", "causal", "inconclusive"]
    verdict: Literal["lift_detected", "no_effect", "inconclusive"]
    confounders: list[str]              # named confounders considered

    # Required additional context (never replaces the seven above):
    ci_level: float = 0.95
    guardrail_proof: GuardrailProof
    diagnostics: dict[str, Any]         # mde, power, n_effective, ess, weight_clip, ...
    rejected_methods: list[dict[str, str]]   # [{"method":"ope_ips_snips_dr","reason":"no_propensities"}, ...]
    packet_id: str
    tx_id: str                          # echoes packet_id for trace correlation

class SimulateRequest(BaseModel):
    world_type: Literal["clean_ab", "geo_structured", "confounded",
                        "zero_lift_placebo"]
    params: dict[str, Any]              # passed to SimulationConfig(**params)
    seed: int = 17

class SimulateResponse(BaseModel):
    world_id: str
    world_type: str
    n_rows: int
    data_uri: str                       # file://<...events.csv>
    metadata_uri: str                   # file://<...metadata.json>
    ground_truth: dict[str, Any]        # echoes simulator metadata — used for tests
```

### Method modules (`services/verifier/src/admatix_verifier/methods/`)

Each module exposes one function with the signature below. Each is independently
unit-tested (§ Acceptance test 2–6).

```python
# methods/guardrail.py
def run(req: VerifyRequest) -> GuardrailProof:
    """Always runs. Pure Python — no statistics, no external libs.
    Walks the action_log (if any) against req.packet.guardrails and emits one
    GuardrailRuleResult per declared rule. Supports at minimum:
      budget_cap, freq_cap, pacing_min, pacing_max, geo_allowlist, audience_allowlist.
    Unknown rule keys produce a `pass=False, predicate="unknown_rule"` row
    rather than a silent skip."""

# methods/bsts.py
def run(req: VerifyRequest, events: pd.DataFrame) -> MethodResult:
    """Pre/post synthetic control via Bayesian structural time series.
    Library: tfcausalimpact==0.0.18 (pinned fallback per SIMULATION-VERIFICATION
    §2.2; tfp-causalimpact is the preferred library but is an optional extra so
    the core image stays light). Returns posterior mean + 95% CI; CI spans 0 →
    verdict=inconclusive."""

# methods/cate.py
def run(req: VerifyRequest, events: pd.DataFrame) -> MethodResult:
    """User-level CATE via econml DML or DR-Learner with honest CIs.
    Falls back to causalml T-Learner if econml refuses the design.
    Returns ATE estimate + bootstrap/asymptotic CI; emits Qini in diagnostics."""

# methods/geo.py
def run(req: VerifyRequest, events: pd.DataFrame) -> MethodResult:
    """Geo-holdout synthetic control + statsmodels power/MDE pre-flight.
    If plausible_lift < MDE at 80% power: verdict=inconclusive,
    reason='underpowered' — before producing a noisy point estimate."""

# methods/ope.py
def run(req: VerifyRequest, events: pd.DataFrame) -> MethodResult:
    """Off-policy evaluation via obp (InverseProbabilityWeighting,
    SelfNormalizedIPS, DoublyRobust). Requires logged propensities in
    events['logging_propensity']; otherwise verifier.select() rejects this
    method up-front. Effective-sample-size below threshold → inconclusive."""
```

### Method selection (`services/verifier/src/admatix_verifier/select.py`)

```python
def select_method(req: VerifyRequest, events: pd.DataFrame) -> str:
    """Returns the method name to run. Selection order, per
    SIMULATION-VERIFICATION §2.6:
      1) logging_propensity column present              → ope_ips_snips_dr
      2) hint.design == "geo_holdout" OR ≥10 distinct geo_ids
         AND treatment varies by geo only               → geo_synthetic_control
      3) user-level (user_id, treatment, outcome, covars) present
                                                        → cate_meta_learner
      4) only an aggregate time series (period, outcome)
                                                        → bsts_synthetic_control
      5) none of the above                              → guardrail_only
    The chosen method, the rejected methods, and the reason each was rejected
    are echoed back in VerifyResponse."""
```

### CLI entry point

```python
# services/verifier/src/admatix_verifier/__main__.py
# `python -m admatix_verifier --port 8088` boots uvicorn on the FastAPI app
# above, reading host/port from CLI flags only (no env vars in this WP).
```

## Files this WP creates

- `services/verifier/pyproject.toml` — package metadata; declares
  `admatix-verifier` as a setuptools/PEP-621 project; entry point
  `admatix-verifier = admatix_verifier.__main__:main`.
- `services/verifier/requirements.txt` — top-level pins (see § Pinned stack).
- `services/verifier/requirements.lock` — full transitive lock produced by
  `uv pip compile` (preferred) or `pip-compile`. CI installs from the lock.
- `services/verifier/src/admatix_verifier/__init__.py` — version export.
- `services/verifier/src/admatix_verifier/__main__.py` — uvicorn launcher.
- `services/verifier/src/admatix_verifier/app.py` — FastAPI app and routes.
- `services/verifier/src/admatix_verifier/models.py` — Pydantic v2 models per
  § Public surface.
- `services/verifier/src/admatix_verifier/select.py` — `select_method` per
  § Public surface.
- `services/verifier/src/admatix_verifier/methods/__init__.py`
- `services/verifier/src/admatix_verifier/methods/guardrail.py`
- `services/verifier/src/admatix_verifier/methods/bsts.py`
- `services/verifier/src/admatix_verifier/methods/cate.py`
- `services/verifier/src/admatix_verifier/methods/geo.py`
- `services/verifier/src/admatix_verifier/methods/ope.py`
- `services/verifier/src/admatix_verifier/loaders.py` — `load_events(uri)` and
  `load_metadata(uri)`; both accept `file://<abs path>` URIs (the only scheme
  the simulator emits today) and bare absolute paths.
- `services/verifier/tests/__init__.py`
- `services/verifier/tests/conftest.py` — Pytest fixtures that call
  `admatix_simulator.generate_world` to materialise one `clean_ab` and one
  `zero_lift_placebo` world under `tmp_path`, returning a built
  `VerifyRequest` for each. Pinned seed, `n_users=2000`,
  `noise_sd=0.0` for speed/determinism.
- `services/verifier/tests/test_guardrail.py`
- `services/verifier/tests/test_bsts.py`
- `services/verifier/tests/test_cate.py`
- `services/verifier/tests/test_geo.py`
- `services/verifier/tests/test_ope.py`
- `services/verifier/tests/test_select.py` — exhaustive coverage of
  `select_method`'s five branches.
- `services/verifier/tests/test_api_contract.py` — TestClient-based contract
  test of `/healthz`, `/verify`, `/simulate`; asserts the response JSON shape
  matches `VerifyResponse` field names exactly (the seven canonical fields
  from §6.2 are present, correctly typed, and never `null` except where the
  Pydantic model permits it).
- `services/verifier/tests/test_coverage_on_simulator.py` — the Phase 3 gate
  contribution test (§ Acceptance test 9).
- `services/verifier/tests/test_placebo_zero.py` — the placebo test
  (§ Acceptance test 8).
- `services/verifier/scripts/smoke_uvicorn.sh` — boots `uvicorn
  admatix_verifier.app:app --port 8088 --host 127.0.0.1`, polls
  `GET /healthz` until 200 (max 30 s), kills the process, exits 0.
- `docs/runbooks/verifier.md` — operator runbook: how to install
  (`python3 -m venv .venv && pip install -r requirements.lock`), how to
  run pytest, how to boot uvicorn, how to issue a sample `POST /verify`
  using a world materialised by `services/simulator`, how to read a
  response, how to regenerate the lock, the rule that the verifier is a
  separate process from any agent.

### Pinned stack (verified versions per SIMULATION-VERIFICATION §4)

```
# requirements.txt (top-level; resolve to requirements.lock via uv/pip-compile)
fastapi==0.115.*                    # API surface
uvicorn[standard]==0.32.*           # ASGI server
pydantic==2.9.*                     # request/response models
numpy==2.1.*                        # numerics
pandas==2.2.*                       # dataframes
scipy==1.14.*                       # used by statsmodels/econml
statsmodels==0.14.*                 # power / MDE; DiD
econml==0.16.0                      # DML, DR-Learner, Causal Forest, honest CIs
causalml==0.16.0                    # S/T/X-learners; Qini/AUUC
obp==0.5.*                          # OPE: IPW, SNIPS, DR
tfcausalimpact==0.0.18              # BSTS — pinned lightweight fallback
                                    # (tfp-causalimpact lives in an optional extra)
pytest==8.3.*
httpx==0.27.*                       # for FastAPI TestClient
```

Optional extra (`admatix-verifier[bsts-tfp]`): `tfp-causalimpact` plus its
TensorFlow + TensorFlow-Probability transitive deps. Not installed by the core
lock; documented in the runbook for operators who want the preferred BSTS
backend.

## Files this WP MUST NOT touch

- `packages/schemas/**` — the frozen contract.
- `packages/core/**`, `packages/connectors/**`, `packages/evidence/**`,
  `packages/policy/**`, `packages/agents/**`, `packages/evals/**`,
  `packages/ui/**` — the TypeScript product surface. WP-S, not WP-R, edits
  `packages/agents` to wire `MeasurementScientistAgent` to this service.
- `apps/**` — no MCP tool registration here. WP-S adds `admatix.verify`.
- `services/ingest/**`, `services/simulator/**` — owned by WP-P / WP-Q (the
  Codex sim-readiness track). WP-R **reads** the simulator as a library via
  `from admatix_simulator import generate_world, SimulationConfig, WorldType`
  in tests/fixtures, and **never modifies** its source.
- `warehouse/**` — the data layer is finished in Phase 2 and is not extended
  here.
- `ledger.*` (Supabase) — the verifier has zero database writes in this WP.
  Verdicts only round-trip into the ledger via WP-S.
- `/opt/admatix/.build/secrets.env` — never read by this WP. The verifier
  takes its inputs through HTTP and reads simulator output from local file
  paths only.

## Acceptance tests

Each test runs under `cd services/verifier && pytest -q`. The numbered tests
below match the test files in § Files this WP creates.

1. **API contract — `test_api_contract.py`.**
   - `GET /healthz` returns 200 and a JSON object with `status == "ok"`, a
     `version` string, and a `libs` dict listing every entry from
     `requirements.txt` with a non-empty version string.
   - `POST /verify` with a fixture-built `VerifyRequest` returns 200 and a JSON
     object whose top-level keys are **exactly** the union of the
     `VerifyResponse` model fields (no extras, no missing). The seven canonical
     fields `estimate, ci_low, ci_high, method, causal_status, verdict,
     confounders` are all present.
   - `POST /verify` with an unknown `method` hint in `req.hint.design` returns
     200 (selector falls back per the §6.2 ladder); a malformed payload returns
     422.
   - `POST /simulate` with `world_type="clean_ab"` returns 200, the
     `ground_truth.ate` is within `1.5 · noise_sd / sqrt(n_users)` of
     `params.true_lift` (sanity check that the simulator round-trips).

2. **Guardrail method — `test_guardrail.py`.** Constructs a `VerifyRequest`
   whose `packet.guardrails = {"budget_cap": 50000, "freq_cap": 3}` and feeds
   an `action_log_uri` to a JSONL file whose total spend is 48 210 and max
   frequency is 2. Asserts the `GuardrailProof.all_pass == True` and each
   rule's `pass == True`. A second case with spend 60 000 asserts
   `budget_cap.pass == False` and `all_pass == False`. No external libraries
   touched — pure Python.

3. **BSTS method — `test_bsts.py`.** On a `clean_ab` world with
   `true_lift=0.04, n_users=2000, noise_sd=0.0, seed=17`, aggregates events
   to a daily time series and calls `methods.bsts.run`. Asserts:
   `result.method == "bsts_synthetic_control"`, `ci_low < estimate < ci_high`,
   `ci_low ≤ 0.04 ≤ ci_high` (CI contains truth at the configured seed). On
   a `zero_lift_placebo` world same shape, asserts `ci_low < 0 < ci_high`
   (CI brackets zero) and `verdict == "inconclusive"`.

4. **CATE method — `test_cate.py`.** On the same two worlds, calls
   `methods.cate.run`. Asserts: `result.method == "cate_meta_learner"`,
   `result.confounders` is non-empty and includes at least `"recency"`,
   `ci_low ≤ ground_truth.ate ≤ ci_high` on `clean_ab`, and on placebo the
   estimate's absolute value is `≤ 0.05 · params.baseline_cr` per
   SIMULATION-VERIFICATION §3.5. The Qini coefficient appears in
   `diagnostics["qini"]`.

5. **Geo method — `test_geo.py`.** Materialises a `geo_structured` world with
   `n_users=4000, n_geos=20, treat_frac=0.5, true_lift=0.04, seed=17`. Calls
   `methods.geo.run`. Asserts: `result.method == "geo_synthetic_control"`,
   `diagnostics["mde"]` and `diagnostics["power"]` are present and numeric,
   `ci_low ≤ 0.04 ≤ ci_high`. A second case with `n_geos=4, true_lift=0.001`
   asserts `verdict == "inconclusive"` and
   `diagnostics["reason"] == "underpowered"` — the engine refuses to commit
   when MDE > plausible lift.

6. **OPE method — `test_ope.py`.** Builds a synthetic events DataFrame with a
   `logging_propensity` column and a known new-policy value. Calls
   `methods.ope.run`. Asserts: `result.method == "ope_ips_snips_dr"`, IPS /
   SNIPS / DR estimates and CIs are all returned in `diagnostics["estimators"]`,
   the SNIPS estimate is within ±15% of the known value. A second case with
   pathological propensity clipping asserts `verdict == "inconclusive"` with
   `diagnostics["reason"] == "extreme_weights"`.

7. **Method selection — `test_select.py`.** For each of the five branches in
   `select_method`, constructs a minimal `VerifyRequest` + `events` DataFrame
   that should trigger that branch and asserts the returned method name. Also
   asserts that `VerifyResponse.rejected_methods` includes every non-selected
   method with a non-empty `reason`.

8. **Placebo returns ~zero — `test_placebo_zero.py`.** Materialises a
   `zero_lift_placebo` world (`true_lift=0.0, baseline_cr=0.03, n_users=4000,
   seed=17`). Calls the full `/verify` pipeline via `TestClient`. Asserts:
   `verdict in {"no_effect", "inconclusive"}`, `verdict != "lift_detected"`,
   `abs(estimate) ≤ 0.05 · 0.03` (SIMULATION-VERIFICATION §3.5 placebo
   tolerance), and `ci_low ≤ 0 ≤ ci_high`. A second case with
   `world_type="zero_lift_placebo"` and `confound_strength=0.4` asserts the
   same — confounders may not manufacture a placebo effect.

9. **Coverage on the simulator — `test_coverage_on_simulator.py`
   (Phase 3 gate contribution).** Iterates over 20 distinct seeds, materialises
   a `clean_ab` world per seed at `n_users=2000, true_lift=0.04, noise_sd=0.0`,
   calls the full `/verify` pipeline, and records whether each 95% CI contains
   the recorded `metadata.ground_truth.ate`. Asserts the fraction of CIs that
   cover truth is **≥ 0.85** (loose Phase 3 floor; the strict
   `[0.93, 0.97]` band from SIMULATION-VERIFICATION §3.2 is WP-T's full
   harness, not this unit-level gate). Also asserts the verdict is
   `lift_detected` on **≥ 0.85** of the 20 worlds. This is the test the Phase
   3 gate quotes for WP-R.

## Verification commands

The build agent runs **exactly** the sequence below at the end of the work
package. All commands run from the worktree root unless noted.

```bash
# 1. Create the lock and install
cd services/verifier
python3.12 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip uv
uv pip compile requirements.txt -o requirements.lock
uv pip sync requirements.lock

# 2. Run the verifier test suite (the nine numbered tests above)
pytest -q

# 3. Boot the FastAPI service via uvicorn and curl /healthz
bash scripts/smoke_uvicorn.sh           # exits 0 only when /healthz returns 200

# 4. Confirm the sibling Python services still pass (WP-R must not regress them)
cd ../..
pytest services/ingest services/simulator -q

# 5. Confirm the TypeScript monorepo is untouched
pnpm -r typecheck
pnpm exec turbo run test --concurrency=1

# 6. Secret scan
pnpm scan-secrets
```

All six commands exit 0 before WP-R is considered green.

## Out of scope

- Any TypeScript change. WP-S, not WP-R, edits `packages/agents` and
  `apps/mcp-server`.
- Writing to Supabase. The verifier produces a `VerifyResponse` over HTTP;
  WP-S is responsible for persisting it into `app.outcome_measurements` and
  emitting the corresponding `ledger.action_events` row.
- Generating Pydantic from Zod. The verifier defines `H0PacketSubset` by hand
  from the fields it actually consumes; cross-language schema generation is
  future work and is not required for the Phase 3 gate.
- The Phase 4 research-grade validation harness (`services/validation`) — SBC,
  full CI-coverage band, RMSE/bias tables, multi-seed variance, Criteo
  back-test. That is WP-T. WP-R's coverage test (§ Acceptance 9) is a
  unit-level floor, not the full Phase 4 bar.
- Avazu and iPinYou support. The verifier's tests run against the simulator
  and (optionally, future work) Hillstrom / Criteo Uplift via WP-P's ingest;
  Avazu / iPinYou were intentionally not acquired in WP-P.
- Authentication on the FastAPI endpoints. The verifier runs on the same VPS
  network as the agent runtime; cross-host auth is post-application work.
- LLM calls of any kind inside the verifier — there are none, by design.

## Definition of Done

All nine acceptance tests pass, the six verification commands exit 0, the
runbook is accurate (a reviewer can follow it from a clean shell and reproduce
green `pytest` + green `/healthz`), and `services/verifier` boots independently
of any TypeScript code. The Phase 3 gate's WP-R contribution (§ Acceptance 9)
is green. WP-S can now consume `/verify` over HTTP without further changes to
this WP.

## Dispatch

Generic dispatcher, `<ID>=R`, model `opus`. Run in Phase 3 Wave 2, after the
`codex/sim-readiness` track has merged into `main`.

```bash
bash /opt/admatix/scripts/dispatch-wp.sh \
  R \
  wp/r-verifier \
  services/verifier \
  docs/build/WP-R-verifier.md \
  opus
```
