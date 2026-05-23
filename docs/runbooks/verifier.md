# Verifier runbook — `services/verifier`

The verifier is the AdMatix independent grader. It is a **standalone FastAPI
process**, never the agent that proposed the action: WP-S wires
`MeasurementScientistAgent` to it over HTTP, but boot, test, and operate it
on its own from this runbook. The verifier has zero LLM calls, no database
writes, no live ad-platform connectors, and no secrets. All input is HTTP;
all data is read from local `file://` paths (the only scheme today).

## 1. Install

Requires Python 3.12 and a network connection to PyPI.

```bash
cd services/verifier
python3.12 -m venv .venv
. .venv/bin/activate
pip install --upgrade pip uv
uv pip compile requirements.txt -o requirements.lock   # only if regenerating
uv pip sync requirements.lock                          # installs from the lock
```

The lock pins every transitive dep. CI installs only from the lock.

### Optional BSTS backend

The core install ships a lightweight statsmodels-based BSTS implementation
(`UnobservedComponents` — a Kalman-filter state-space model). If you prefer
Google's `tfp-causalimpact` (which pulls TensorFlow + TensorFlow-Probability,
~600 MB):

```bash
pip install '.[bsts-tfp]'
```

The HTTP contract is unchanged.

## 2. Run the tests

```bash
cd services/verifier
. .venv/bin/activate
pytest -q
```

Expected output: **26 passed** in roughly 35 s on a 4-core VPS. The named
acceptance tests (one file per number) match WP-R-verifier.md §Acceptance
tests 1–9.

## 3. Boot the FastAPI service

```bash
cd services/verifier
. .venv/bin/activate
python -m admatix_verifier --host 127.0.0.1 --port 8088
# or, equivalently:
PYTHONPATH=src python -m uvicorn admatix_verifier.app:app --host 127.0.0.1 --port 8088
```

A one-shot smoke check that exits 0 only on a healthy boot:

```bash
. .venv/bin/activate
bash scripts/smoke_uvicorn.sh
```

## 4. Issue a sample `POST /verify`

Materialise a world via the simulator, then verify it. Run from the repo
root:

```bash
cd services/verifier && . .venv/bin/activate
python - <<'PY'
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path("../simulator/src").resolve()))
sys.path.insert(0, str(Path("src").resolve()))

from admatix_simulator import SimulationConfig, generate_world
from admatix_verifier.models import H0PacketSubset, VerifyRequest

config = SimulationConfig(
    world_type="clean_ab",
    baseline_cr=0.03,
    true_lift=0.04,
    n_users=2000,
    noise_sd=0.0,
    seasonality=0.0,
    n_periods=30,
    n_geos=20,
    seed=17,
)
out = Path("/tmp/admatix-sample-world").resolve()
out.mkdir(parents=True, exist_ok=True)
world = generate_world(config, out)

req = VerifyRequest(
    packet=H0PacketSubset(
        packet_id=f"pkt_{world.world_id}",
        tenant_id="tenant_demo",
        account_ref="fixture:sample",
        goal="recover_lift",
        hypothesis="treatment lifts conversion",
        causal_status="experimental",
        guardrails={"budget_cap": 50_000, "freq_cap": 3},
        evidence_refs=[f"metric:sim:{world.world_id}"],
    ),
    data_uri=world.data_uri,
    metadata_uri=world.metadata_path.resolve().as_uri(),
)
print(json.dumps(req.model_dump(by_alias=True), indent=2))
PY
```

Boot the verifier in another terminal (`python -m admatix_verifier`) then:

```bash
curl -s -X POST http://127.0.0.1:8088/verify \
  -H 'content-type: application/json' \
  -d @- <<EOF | jq .
$(<previous-request.json)
EOF
```

The response carries the seven canonical fields plus the guardrail proof,
diagnostics (Qini, MDE, power, n_effective, ESS, model backend), the list
of rejected methods, and `tx_id == packet_id`.

## 5. Read the response

| Field | Type | Meaning |
| --- | --- | --- |
| `estimate` | float \| null | Point estimate of the causal effect (`null` only when `method == "guardrail_only"`). |
| `ci_low`, `ci_high` | float \| null | 95% CI bounds. |
| `method` | enum | One of `guardrail_only`, `bsts_synthetic_control`, `cate_meta_learner`, `geo_synthetic_control`, `ope_ips_snips_dr`. |
| `causal_status` | enum | `inconclusive` when the CI spans zero or the design is underpowered. |
| `verdict` | enum | `lift_detected` \| `no_effect` \| `inconclusive`. |
| `confounders` | list[str] | Named confounders the chosen method accounted for. |
| `guardrail_proof` | object | Always-on deterministic proof of guardrail compliance. |
| `diagnostics` | object | Method-specific (e.g. Qini, MDE, power, ESS, weight clip, backend, posterior SE). |
| `rejected_methods` | list | The methods that were not chosen, each with a `reason`. |
| `packet_id`, `tx_id` | str | Trace correlation — both equal the input packet_id. |

The verifier **never** returns a bare per-decision causal lift number. Every
response carries a CI, a method, and a confounders list; when evidence is
thin the verdict is `inconclusive` rather than a noisy point estimate.

## 6. Regenerate the lock

The lock is sticky and only changes when a dependency moves:

```bash
cd services/verifier && . .venv/bin/activate
uv pip compile requirements.txt -o requirements.lock
uv pip sync requirements.lock
pytest -q
```

Commit `requirements.lock` together with whatever `requirements.txt` change
triggered it.

## 7. Architectural invariants

- **The verifier is a separate process from any agent.** WP-S wires
  `MeasurementScientistAgent` to it over HTTP — they never share an
  interpreter.
- **Read-only.** No database writes; no platform calls. The verifier
  reads simulator output from local `file://` paths and reads the
  H0 packet from the request body.
- **No LLM calls.** Anywhere. By design.
- **No secrets.** The verifier takes its inputs through HTTP and writes
  nothing outside `data/sim/`. `pnpm scan-secrets` passes.

## 8. Deviations from WP-R-verifier.md §Pinned stack

The spec's pinned stack as written is impossible to resolve: both
`tfcausalimpact==0.0.18` and `obp==0.5.*` pin `pandas<2.2`, which conflicts
with the spec's own `pandas==2.2.*` / `numpy==2.1.*` / `econml 0.16.0` /
`causalml 0.16.0` pins. We resolved this by:

| Spec line | Decision | Rationale |
| --- | --- | --- |
| `scipy==1.14.*` | `scipy>=1.14,<1.17` | `causalml==0.16.0` requires `scipy>=1.16`. |
| `tfcausalimpact==0.0.18` | dropped from core lock; available behind `[bsts-tfp]` extra | The BSTS layer is implemented against `statsmodels.UnobservedComponents` instead — a Kalman-filter state-space BSTS, the standard non-TF implementation. |
| `obp==0.5.*` | dropped from core lock | IPW/SNIPS/DR are implemented directly in numpy with the standard closed-form estimators and influence-function-style asymptotic CIs. |

All other version pins follow the spec exactly.
