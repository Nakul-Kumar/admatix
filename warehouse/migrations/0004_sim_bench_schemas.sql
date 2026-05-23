BEGIN;

-- ============================================================================
-- AdMatix Data Layer -- Part 6: sim and bench schemas
-- Simulator (known ground truth) + verification benchmark.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS sim;
COMMENT ON SCHEMA sim IS
  'The AdMatix simulator. Generates synthetic ad campaigns with a known, hidden ground-truth incremental lift, so verification accuracy can be measured against truth. The only data source where causal effects are known exactly.';

CREATE SCHEMA IF NOT EXISTS bench;
COMMENT ON SCHEMA bench IS
  'The AdMatix verification benchmark. Defines tasks (including unsafe ones the system must block), records benchmark runs with pinned inputs, stores per-task results, and holds the ground-truth answers used to score runs.';

-- ----------------------------------------------------------------------------
-- Enums for sim and bench.
-- ----------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'sim'
       AND t.typname = 'event_type'
  ) THEN
    CREATE TYPE sim.event_type AS ENUM ('impression', 'click', 'conversion', 'spend');
  END IF;
END;
$$;
COMMENT ON TYPE sim.event_type IS
  'Type of a simulated event emitted into sim.events.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'sim'
       AND t.typname = 'treatment_arm'
  ) THEN
    CREATE TYPE sim.treatment_arm AS ENUM ('treatment', 'control', 'holdout');
  END IF;
END;
$$;
COMMENT ON TYPE sim.treatment_arm IS
  'The experimental arm a simulated unit is assigned to.';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'bench'
       AND t.typname = 'task_kind'
  ) THEN
    CREATE TYPE bench.task_kind AS ENUM ('audit', 'safety', 'evidence', 'state_diff', 'policy');
  END IF;
END;
$$;
COMMENT ON TYPE bench.task_kind IS
  'Category of a benchmark task. Mirrors BenchmarkTask.kind in @admatix/schemas.';

-- ----------------------------------------------------------------------------
-- Table: sim.scenarios -- a configured simulation scenario.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sim.scenarios (
  scenario_id     uuid          NOT NULL DEFAULT gen_random_uuid(),
  scenario_key    text          NOT NULL,
  name            text          NOT NULL,
  description     text,
  random_seed     bigint        NOT NULL,
  horizon_days    integer       NOT NULL DEFAULT 30,
  config          jsonb         NOT NULL DEFAULT '{}'::jsonb,
  config_hash     char(64)      NOT NULL,
  created_at      timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_sim_scenarios        PRIMARY KEY (scenario_id),
  CONSTRAINT uq_sim_scenarios_key    UNIQUE (scenario_key),
  CONSTRAINT ck_sim_scenarios_horizon CHECK (horizon_days > 0),
  CONSTRAINT ck_sim_scenarios_hash_hex CHECK (config_hash ~ '^[0-9a-f]{64}$')
);
COMMENT ON TABLE sim.scenarios IS
  'A configured simulation scenario. random_seed and config_hash make every scenario fully reproducible.';
COMMENT ON COLUMN sim.scenarios.scenario_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN sim.scenarios.scenario_key IS 'Stable human-readable scenario identifier.';
COMMENT ON COLUMN sim.scenarios.name IS 'Human-readable scenario name.';
COMMENT ON COLUMN sim.scenarios.description IS 'Description of what the scenario exercises.';
COMMENT ON COLUMN sim.scenarios.random_seed IS 'RNG seed; fixing it makes the scenario deterministic and reproducible.';
COMMENT ON COLUMN sim.scenarios.horizon_days IS 'Number of simulated days the scenario runs.';
COMMENT ON COLUMN sim.scenarios.config IS 'Full scenario configuration as jsonb (market params, noise, agent behaviours).';
COMMENT ON COLUMN sim.scenarios.config_hash IS 'SHA-256 (hex) of the config, for integrity and reproducibility checks.';
COMMENT ON COLUMN sim.scenarios.created_at IS 'UTC creation timestamp.';
CREATE INDEX IF NOT EXISTS idx_sim_scenarios_key ON sim.scenarios (scenario_key);

-- ----------------------------------------------------------------------------
-- Table: sim.campaigns -- a synthetic campaign within a scenario.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sim.campaigns (
  sim_campaign_id   uuid          NOT NULL DEFAULT gen_random_uuid(),
  scenario_id       uuid          NOT NULL,
  sim_campaign_key  text          NOT NULL,
  name              text          NOT NULL,
  channel           text          NOT NULL,
  daily_budget      numeric(18,4) NOT NULL DEFAULT 0,
  base_ctr          numeric(10,8) NOT NULL DEFAULT 0,
  base_cvr          numeric(10,8) NOT NULL DEFAULT 0,
  base_aov          numeric(18,4) NOT NULL DEFAULT 0,
  params            jsonb         NOT NULL DEFAULT '{}'::jsonb,
  created_at        timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_sim_campaigns          PRIMARY KEY (sim_campaign_id),
  CONSTRAINT fk_sim_campaigns_scenario FOREIGN KEY (scenario_id)
                                       REFERENCES sim.scenarios (scenario_id) ON DELETE CASCADE,
  CONSTRAINT uq_sim_campaigns_key      UNIQUE (scenario_id, sim_campaign_key)
);
COMMENT ON TABLE sim.campaigns IS
  'A synthetic campaign within a simulation scenario. Carries the base-rate parameters (CTR, CVR, AOV) the simulator draws events from.';
COMMENT ON COLUMN sim.campaigns.sim_campaign_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN sim.campaigns.scenario_id IS 'Parent scenario (FK sim.scenarios).';
COMMENT ON COLUMN sim.campaigns.sim_campaign_key IS 'Human-readable campaign key, unique within a scenario.';
COMMENT ON COLUMN sim.campaigns.name IS 'Human-readable campaign name.';
COMMENT ON COLUMN sim.campaigns.channel IS 'Simulated channel (search, social, display, ...).';
COMMENT ON COLUMN sim.campaigns.daily_budget IS 'Simulated daily budget.';
COMMENT ON COLUMN sim.campaigns.base_ctr IS 'Baseline click-through rate the simulator draws from.';
COMMENT ON COLUMN sim.campaigns.base_cvr IS 'Baseline conversion rate the simulator draws from.';
COMMENT ON COLUMN sim.campaigns.base_aov IS 'Baseline average order value the simulator draws from.';
COMMENT ON COLUMN sim.campaigns.params IS 'Additional campaign-specific simulation parameters as jsonb.';
COMMENT ON COLUMN sim.campaigns.created_at IS 'UTC creation timestamp.';
CREATE INDEX IF NOT EXISTS idx_sim_campaigns_scenario ON sim.campaigns (scenario_id);
CREATE INDEX IF NOT EXISTS idx_sim_campaigns_key      ON sim.campaigns (sim_campaign_key);

-- ----------------------------------------------------------------------------
-- Table: sim.true_effects -- the hidden ground-truth incremental lift.
-- This is the answer key. The verifier must never read it; the scorer does.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sim.true_effects (
  true_effect_id    uuid          NOT NULL DEFAULT gen_random_uuid(),
  scenario_id       uuid          NOT NULL,
  sim_campaign_id   uuid          NOT NULL,
  intervention_key  text          NOT NULL,
  metric            text          NOT NULL,
  true_incremental_lift numeric(18,8) NOT NULL,
  true_lift_pct     numeric(12,8),
  true_baseline     numeric(18,8),
  effect_start_day  integer       NOT NULL DEFAULT 0,
  effect_end_day    integer,
  noise_sd          numeric(18,8) NOT NULL DEFAULT 0,
  notes             text,
  created_at        timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_sim_true_effects          PRIMARY KEY (true_effect_id),
  CONSTRAINT fk_sim_true_effects_scenario FOREIGN KEY (scenario_id)
                                          REFERENCES sim.scenarios (scenario_id) ON DELETE CASCADE,
  CONSTRAINT fk_sim_true_effects_campaign FOREIGN KEY (sim_campaign_id)
                                          REFERENCES sim.campaigns (sim_campaign_id) ON DELETE CASCADE,
  CONSTRAINT uq_sim_true_effects          UNIQUE (sim_campaign_id, intervention_key, metric)
);
COMMENT ON TABLE sim.true_effects IS
  'The hidden ground-truth incremental lift for each simulated intervention -- the answer key. The verification pipeline must NOT read this table; only the scorer reads it to grade the verifier estimate against truth.';
COMMENT ON COLUMN sim.true_effects.true_effect_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN sim.true_effects.scenario_id IS 'Parent scenario (FK sim.scenarios).';
COMMENT ON COLUMN sim.true_effects.sim_campaign_id IS 'Simulated campaign the effect applies to (FK sim.campaigns).';
COMMENT ON COLUMN sim.true_effects.intervention_key IS 'Identifier of the intervention whose true effect this row records (e.g. "budget_+20pct").';
COMMENT ON COLUMN sim.true_effects.metric IS 'The metric the effect is expressed on (conversions, revenue, ...).';
COMMENT ON COLUMN sim.true_effects.true_incremental_lift IS 'The true incremental lift in absolute metric units. The ground truth.';
COMMENT ON COLUMN sim.true_effects.true_lift_pct IS 'The true incremental lift as a percentage of baseline.';
COMMENT ON COLUMN sim.true_effects.true_baseline IS 'The true counterfactual baseline (metric value with no intervention).';
COMMENT ON COLUMN sim.true_effects.effect_start_day IS 'Simulated day the effect begins.';
COMMENT ON COLUMN sim.true_effects.effect_end_day IS 'Simulated day the effect ends; null if it persists to the horizon.';
COMMENT ON COLUMN sim.true_effects.noise_sd IS 'Standard deviation of the noise the simulator adds around the true effect.';
COMMENT ON COLUMN sim.true_effects.notes IS 'Optional notes on how the effect was configured.';
COMMENT ON COLUMN sim.true_effects.created_at IS 'UTC creation timestamp.';
CREATE INDEX IF NOT EXISTS idx_sim_true_effects_scenario ON sim.true_effects (scenario_id);
CREATE INDEX IF NOT EXISTS idx_sim_true_effects_campaign ON sim.true_effects (sim_campaign_id);
CREATE INDEX IF NOT EXISTS idx_sim_true_effects_metric   ON sim.true_effects (metric);

-- ----------------------------------------------------------------------------
-- Table: sim.events -- the event stream emitted by the simulator.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sim.events (
  sim_event_id    bigint          GENERATED ALWAYS AS IDENTITY,
  scenario_id     uuid            NOT NULL,
  sim_campaign_id uuid            NOT NULL,
  true_effect_id  uuid,
  event_type      sim.event_type  NOT NULL,
  treatment_arm   sim.treatment_arm NOT NULL,
  sim_day         integer         NOT NULL,
  event_ts        timestamptz     NOT NULL,
  user_key        text            NOT NULL,
  quantity        numeric(18,6)   NOT NULL DEFAULT 1,
  spend           numeric(18,6)   NOT NULL DEFAULT 0,
  revenue         numeric(18,6)   NOT NULL DEFAULT 0,
  attributes      jsonb           NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz     NOT NULL DEFAULT now(),

  CONSTRAINT pk_sim_events           PRIMARY KEY (sim_event_id),
  CONSTRAINT fk_sim_events_scenario  FOREIGN KEY (scenario_id)
                                     REFERENCES sim.scenarios (scenario_id) ON DELETE CASCADE,
  CONSTRAINT fk_sim_events_campaign  FOREIGN KEY (sim_campaign_id)
                                     REFERENCES sim.campaigns (sim_campaign_id) ON DELETE CASCADE,
  CONSTRAINT fk_sim_events_effect    FOREIGN KEY (true_effect_id)
                                     REFERENCES sim.true_effects (true_effect_id) ON DELETE SET NULL
);
COMMENT ON TABLE sim.events IS
  'The event stream produced by the simulator: impressions, clicks, conversions and spend, each tagged with the treatment arm. This is the observable data the verifier consumes; the true effect behind it lives in sim.true_effects.';
COMMENT ON COLUMN sim.events.sim_event_id IS 'Surrogate primary key (identity).';
COMMENT ON COLUMN sim.events.scenario_id IS 'Parent scenario (FK sim.scenarios).';
COMMENT ON COLUMN sim.events.sim_campaign_id IS 'Simulated campaign the event belongs to (FK sim.campaigns).';
COMMENT ON COLUMN sim.events.true_effect_id IS 'The true effect that generated this event, if any (FK sim.true_effects). Used only by the scorer.';
COMMENT ON COLUMN sim.events.event_type IS 'Event type: impression | click | conversion | spend.';
COMMENT ON COLUMN sim.events.treatment_arm IS 'Experimental arm of the user: treatment | control | holdout.';
COMMENT ON COLUMN sim.events.sim_day IS 'Simulated day index within the scenario horizon.';
COMMENT ON COLUMN sim.events.event_ts IS 'UTC timestamp of the simulated event.';
COMMENT ON COLUMN sim.events.user_key IS 'Synthetic user identifier.';
COMMENT ON COLUMN sim.events.quantity IS 'Event quantity (1 per discrete event; supports fractional credit).';
COMMENT ON COLUMN sim.events.spend IS 'Spend attributed to the event.';
COMMENT ON COLUMN sim.events.revenue IS 'Revenue attributed to the event.';
COMMENT ON COLUMN sim.events.attributes IS 'Additional simulated event attributes as jsonb.';
COMMENT ON COLUMN sim.events.created_at IS 'UTC timestamp the event row was written.';
CREATE INDEX IF NOT EXISTS idx_sim_events_scenario  ON sim.events (scenario_id);
CREATE INDEX IF NOT EXISTS idx_sim_events_campaign  ON sim.events (sim_campaign_id);
CREATE INDEX IF NOT EXISTS idx_sim_events_effect    ON sim.events (true_effect_id);
CREATE INDEX IF NOT EXISTS idx_sim_events_type      ON sim.events (event_type);
CREATE INDEX IF NOT EXISTS idx_sim_events_arm       ON sim.events (treatment_arm);
CREATE INDEX IF NOT EXISTS idx_sim_events_day       ON sim.events (sim_day);
CREATE INDEX IF NOT EXISTS idx_sim_events_ts        ON sim.events (event_ts);
CREATE INDEX IF NOT EXISTS idx_sim_events_user      ON sim.events (user_key);

-- ----------------------------------------------------------------------------
-- Table: bench.tasks -- a single benchmark task.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bench.tasks (
  task_id        uuid           NOT NULL DEFAULT gen_random_uuid(),
  task_key       text           NOT NULL,
  suite          text           NOT NULL,
  kind           bench.task_kind NOT NULL,
  description    text           NOT NULL,
  fixture        text           NOT NULL,
  expected       jsonb          NOT NULL DEFAULT '{}'::jsonb,
  is_unsafe      boolean        NOT NULL DEFAULT false,
  created_at     timestamptz    NOT NULL DEFAULT now(),
  updated_at     timestamptz    NOT NULL DEFAULT now(),

  CONSTRAINT pk_bench_tasks      PRIMARY KEY (task_id),
  CONSTRAINT uq_bench_tasks_key  UNIQUE (suite, task_key)
);
COMMENT ON TABLE bench.tasks IS
  'A single benchmark task. Unsafe tasks (is_unsafe = true) MUST be blocked by the system to count as passed.';
COMMENT ON COLUMN bench.tasks.task_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN bench.tasks.task_key IS 'Stable human-readable task identifier, unique within a suite.';
COMMENT ON COLUMN bench.tasks.suite IS 'Benchmark suite the task belongs to.';
COMMENT ON COLUMN bench.tasks.kind IS 'Task category: audit | safety | evidence | state_diff | policy.';
COMMENT ON COLUMN bench.tasks.description IS 'Human-readable description of what the task tests.';
COMMENT ON COLUMN bench.tasks.fixture IS 'Identifier of the fixture/dataset the task runs against.';
COMMENT ON COLUMN bench.tasks.expected IS 'Expected outcome as jsonb, used to score a run.';
COMMENT ON COLUMN bench.tasks.is_unsafe IS 'True if the task represents an unsafe request the system must block.';
COMMENT ON COLUMN bench.tasks.created_at IS 'UTC creation timestamp.';
COMMENT ON COLUMN bench.tasks.updated_at IS 'UTC timestamp of the last mutation (maintained by trigger).';
CREATE INDEX IF NOT EXISTS idx_bench_tasks_suite  ON bench.tasks (suite);
CREATE INDEX IF NOT EXISTS idx_bench_tasks_kind   ON bench.tasks (kind);
CREATE INDEX IF NOT EXISTS idx_bench_tasks_unsafe ON bench.tasks (is_unsafe);
DROP TRIGGER IF EXISTS trg_bench_tasks_touch ON bench.tasks;
CREATE TRIGGER trg_bench_tasks_touch BEFORE UPDATE ON bench.tasks
  FOR EACH ROW EXECUTE FUNCTION public.admatix_touch_updated_at();

-- ----------------------------------------------------------------------------
-- Table: bench.runs -- one execution of a benchmark suite with pinned inputs.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bench.runs (
  run_id           uuid          NOT NULL DEFAULT gen_random_uuid(),
  suite            text          NOT NULL,
  fixture_version  text          NOT NULL,
  code_version     text          NOT NULL,
  policy_version   text          NOT NULL,
  model            text          NOT NULL,
  summary          jsonb         NOT NULL DEFAULT '{}'::jsonb,
  pass_count       integer       NOT NULL DEFAULT 0,
  fail_count       integer       NOT NULL DEFAULT 0,
  started_at       timestamptz   NOT NULL DEFAULT now(),
  finished_at      timestamptz,
  created_at       timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_bench_runs       PRIMARY KEY (run_id),
  CONSTRAINT ck_bench_runs_counts CHECK (pass_count >= 0 AND fail_count >= 0)
);
COMMENT ON TABLE bench.runs IS
  'One execution of a benchmark suite. Pins fixture, code, policy and model versions so results are reproducible and comparable across runs.';
COMMENT ON COLUMN bench.runs.run_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN bench.runs.suite IS 'Benchmark suite executed.';
COMMENT ON COLUMN bench.runs.fixture_version IS 'Pinned fixture/dataset version.';
COMMENT ON COLUMN bench.runs.code_version IS 'Pinned AdMatix code version (git sha or tag).';
COMMENT ON COLUMN bench.runs.policy_version IS 'Pinned policy version in force during the run.';
COMMENT ON COLUMN bench.runs.model IS 'Pinned model id used during the run.';
COMMENT ON COLUMN bench.runs.summary IS 'jsonb map of aggregate metric -> value for the run.';
COMMENT ON COLUMN bench.runs.pass_count IS 'Number of tasks that passed.';
COMMENT ON COLUMN bench.runs.fail_count IS 'Number of tasks that failed.';
COMMENT ON COLUMN bench.runs.started_at IS 'UTC timestamp the run began.';
COMMENT ON COLUMN bench.runs.finished_at IS 'UTC timestamp the run completed; null while in progress.';
COMMENT ON COLUMN bench.runs.created_at IS 'UTC timestamp the run row was written.';
CREATE INDEX IF NOT EXISTS idx_bench_runs_suite      ON bench.runs (suite);
CREATE INDEX IF NOT EXISTS idx_bench_runs_model      ON bench.runs (model);
CREATE INDEX IF NOT EXISTS idx_bench_runs_started_at ON bench.runs (started_at);

-- ----------------------------------------------------------------------------
-- Table: bench.results -- the per-task result within a run.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bench.results (
  result_id              uuid          NOT NULL DEFAULT gen_random_uuid(),
  run_id                 uuid          NOT NULL,
  task_id                uuid          NOT NULL,
  passed                 boolean       NOT NULL,
  score                  numeric(5,4)  NOT NULL DEFAULT 0,
  unsafe_write_attempted boolean       NOT NULL DEFAULT false,
  budget_cap_violation   boolean       NOT NULL DEFAULT false,
  hallucinated_id        boolean       NOT NULL DEFAULT false,
  evidence_coverage      numeric(5,4)  NOT NULL DEFAULT 0,
  rollback_coverage      numeric(5,4)  NOT NULL DEFAULT 0,
  notes                  text[]        NOT NULL DEFAULT '{}',
  output                 jsonb         NOT NULL DEFAULT '{}'::jsonb,
  created_at             timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_bench_results        PRIMARY KEY (result_id),
  CONSTRAINT fk_bench_results_run    FOREIGN KEY (run_id)
                                     REFERENCES bench.runs (run_id) ON DELETE CASCADE,
  CONSTRAINT fk_bench_results_task   FOREIGN KEY (task_id)
                                     REFERENCES bench.tasks (task_id) ON DELETE CASCADE,
  CONSTRAINT uq_bench_results        UNIQUE (run_id, task_id),
  CONSTRAINT ck_bench_results_score  CHECK (score >= 0 AND score <= 1),
  CONSTRAINT ck_bench_results_evidence_cov CHECK (evidence_coverage >= 0 AND evidence_coverage <= 1),
  CONSTRAINT ck_bench_results_rollback_cov CHECK (rollback_coverage >= 0 AND rollback_coverage <= 1)
);
COMMENT ON TABLE bench.results IS
  'The result of one task within one benchmark run. Captures the pass/fail verdict, score, and the safety counters that gate AdMatix release decisions.';
COMMENT ON COLUMN bench.results.result_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN bench.results.run_id IS 'The run this result belongs to (FK bench.runs).';
COMMENT ON COLUMN bench.results.task_id IS 'The task this result scores (FK bench.tasks).';
COMMENT ON COLUMN bench.results.passed IS 'True if the task passed.';
COMMENT ON COLUMN bench.results.score IS 'Continuous score in [0,1] for the task.';
COMMENT ON COLUMN bench.results.unsafe_write_attempted IS 'True if the system attempted an unsafe write (an automatic fail).';
COMMENT ON COLUMN bench.results.budget_cap_violation IS 'True if a budget cap was violated.';
COMMENT ON COLUMN bench.results.hallucinated_id IS 'True if the system referenced a non-existent entity id.';
COMMENT ON COLUMN bench.results.evidence_coverage IS 'Fraction of claims backed by valid evidence refs, in [0,1].';
COMMENT ON COLUMN bench.results.rollback_coverage IS 'Fraction of actions carrying a valid rollback, in [0,1].';
COMMENT ON COLUMN bench.results.notes IS 'Array of free-text notes on the result.';
COMMENT ON COLUMN bench.results.output IS 'Full system output for the task as jsonb, for inspection and replay.';
COMMENT ON COLUMN bench.results.created_at IS 'UTC timestamp the result was written.';
CREATE INDEX IF NOT EXISTS idx_bench_results_run_id  ON bench.results (run_id);
CREATE INDEX IF NOT EXISTS idx_bench_results_task_id ON bench.results (task_id);
CREATE INDEX IF NOT EXISTS idx_bench_results_passed  ON bench.results (passed);

-- ----------------------------------------------------------------------------
-- Table: bench.ground_truth -- the canonical answer key for benchmark tasks.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bench.ground_truth (
  ground_truth_id   uuid          NOT NULL DEFAULT gen_random_uuid(),
  task_id           uuid          NOT NULL,
  scenario_id       uuid,
  true_effect_id    uuid,
  answer_key        jsonb         NOT NULL DEFAULT '{}'::jsonb,
  expected_verdict  text          NOT NULL,
  expected_lift     numeric(18,8),
  tolerance         numeric(18,8) NOT NULL DEFAULT 0,
  rationale         text,
  created_at        timestamptz   NOT NULL DEFAULT now(),

  CONSTRAINT pk_bench_ground_truth        PRIMARY KEY (ground_truth_id),
  CONSTRAINT fk_bench_ground_truth_task   FOREIGN KEY (task_id)
                                          REFERENCES bench.tasks (task_id) ON DELETE CASCADE,
  CONSTRAINT fk_bench_ground_truth_scenario FOREIGN KEY (scenario_id)
                                          REFERENCES sim.scenarios (scenario_id) ON DELETE SET NULL,
  CONSTRAINT fk_bench_ground_truth_effect FOREIGN KEY (true_effect_id)
                                          REFERENCES sim.true_effects (true_effect_id) ON DELETE SET NULL,
  CONSTRAINT uq_bench_ground_truth_task   UNIQUE (task_id)
);
COMMENT ON TABLE bench.ground_truth IS
  'The canonical answer key for a benchmark task. For simulator-backed tasks it links to sim.true_effects so the scorer can compare an estimate against the known truth within tolerance.';
COMMENT ON COLUMN bench.ground_truth.ground_truth_id IS 'Surrogate primary key (UUID v4).';
COMMENT ON COLUMN bench.ground_truth.task_id IS 'The task this answer key belongs to (FK bench.tasks).';
COMMENT ON COLUMN bench.ground_truth.scenario_id IS 'Simulator scenario backing the task, if any (FK sim.scenarios).';
COMMENT ON COLUMN bench.ground_truth.true_effect_id IS 'The specific true effect this task is graded against (FK sim.true_effects).';
COMMENT ON COLUMN bench.ground_truth.answer_key IS 'Full expected answer as jsonb.';
COMMENT ON COLUMN bench.ground_truth.expected_verdict IS 'The expected high-level verdict (e.g. "block", "allow", "flag_waste").';
COMMENT ON COLUMN bench.ground_truth.expected_lift IS 'The expected incremental lift value, where the task scores a numeric estimate.';
COMMENT ON COLUMN bench.ground_truth.tolerance IS 'Allowed absolute deviation of an estimate from expected_lift to still pass.';
COMMENT ON COLUMN bench.ground_truth.rationale IS 'Explanation of why this is the correct answer.';
COMMENT ON COLUMN bench.ground_truth.created_at IS 'UTC creation timestamp.';
CREATE INDEX IF NOT EXISTS idx_bench_ground_truth_task     ON bench.ground_truth (task_id);
CREATE INDEX IF NOT EXISTS idx_bench_ground_truth_scenario ON bench.ground_truth (scenario_id);
CREATE INDEX IF NOT EXISTS idx_bench_ground_truth_effect   ON bench.ground_truth (true_effect_id);

-- ----------------------------------------------------------------------------
-- Privileges for the sim and bench schemas.
-- ----------------------------------------------------------------------------
GRANT USAGE ON SCHEMA sim, bench TO admatix_app, admatix_readonly;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA sim   TO admatix_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA bench TO admatix_app;
GRANT SELECT ON ALL TABLES IN SCHEMA sim   TO admatix_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA bench TO admatix_readonly;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA sim   TO admatix_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA bench TO admatix_app;

-- NOTE on sim.true_effects: it is the answer key. The verification pipeline
-- role must not read it. In production, run the verifier under a dedicated
-- role and add:
--   REVOKE SELECT ON sim.true_effects FROM admatix_verifier;
-- so the verifier physically cannot see ground truth. Only the scorer role
-- retains SELECT on sim.true_effects and bench.ground_truth.

COMMIT;
