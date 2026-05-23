# AdMatix Head-to-Head Benchmark

**Question this benchmark answers:** does a general AI agent buying ads make
better SPENDING decisions WITH AdMatix than without?

**Method:** put a real LLM media buyer (headless `claude` invocation) inside the
AdMatix simulator (where the true incremental effect of every campaign is known
by construction) and measure the dollar difference between four arms:

| Arm | Buyer skill pack | AdMatix gate? |
|-----|------------------|---------------|
| A   | `basic`          | no            |
| B   | `basic`          | yes           |
| C   | `modern`         | no            |
| D   | `modern`         | yes           |

Within a skill tier the buyer is IDENTICAL across arms — the only difference
A→B and C→D is whether scale-up proposals must pass the AdMatix gate (an H0
packet + an independent verifier verdict) before being applied. The no-AdMatix
arms are NOT artificially weakened.

## What's in this package

- `src/admatix_benchmark/env.py` — `SimulatedAdAccountEnv`. Each campaign
  is a generative simulator world with known ground-truth lift. The buyer
  sees REPORTED metrics only (the biased platform-style numbers); the env
  tracks both reported and true streams.
- `src/admatix_benchmark/buyer/policy_basic.py` &
  `policy_modern.py` — deterministic, faithful behavioral policies that
  optimize against the same reported metrics the LLM sees. Used to extend
  seed counts cheaply.
- `src/admatix_benchmark/buyer/llm.py` — `ClaudeHeadlessBuyer`. Wraps the
  `claude -p` CLI; one invocation per decision day. Used on a representative
  arm×world×seed slice for authentic LLM-driven results.
- `src/admatix_benchmark/gate.py` — the AdMatix gate. Builds an H0 packet
  for each proposed scale-up, calls the real `admatix_verifier`, and decides
  allow/hold/cut. **Consumes; does not reimplement.**
- `src/admatix_benchmark/runner.py` — runs one (arm × world × seed) and
  emits a full decision log. The driver in `cli.py` aggregates over the
  matrix and writes `results/scorecard.json` + `results/decisions.json`.
- `RESULTS-SCHEMA.md` — the exact schema of the two output artifacts.

## Reproducing

```bash
# 1. Install deps (verifier pins the heavy ML stack)
uv venv .venv --python 3.12
source .venv/bin/activate
uv pip install -r services/verifier/requirements.txt
uv pip install -e services/verifier
uv pip install -e services/benchmark

# 2. Run tests
PYTHONPATH=services/simulator/src pytest services/benchmark/tests

# 3. Run the full benchmark (LLM-driven subset + policy-extended seeds)
PYTHONPATH=services/simulator/src python -m admatix_benchmark.cli run-all \
  --out-dir services/benchmark/results

# 4. Inspect the scorecard
cat services/benchmark/results/scorecard.json | jq '.by_arm'
```

## Honesty rules baked into the design

1. **Identical buyer across arms within a skill tier.** Same prompt, same
   model, same seed → same proposed actions. The only divergence is the
   gate. Verified by `tests/test_runner.py`.
2. **Reported metrics are biased the same way for everyone.** Both arms see
   reported ROAS that over-states true lift; the no-AdMatix arm isn't given
   any extra disadvantage.
3. **Ground-truth lift is hidden from every buyer and from the verifier.**
   Only the env (and the final scoring) read `metadata.json.ground_truth`.
4. **Verdicts are reported honestly.** If AdMatix doesn't help (or hurts)
   on a world type, the scorecard and the phase report say so.
5. **Everything seeded.** Same seed reproduces the same run end-to-end.
