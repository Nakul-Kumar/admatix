#!/usr/bin/env node
import { existsSync } from "node:fs";
import { dirname, delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const isWindows = process.platform === "win32";

const services = {
  ingest: {
    venv: "services/ingest/.venv",
    requirements: ["services/ingest/requirements.txt"],
    pythonpath: ["services/ingest/src"],
    tests: ["services/ingest/tests"],
  },
  simulator: {
    venv: "services/simulator/.venv",
    requirements: ["services/simulator/requirements.txt"],
    pythonpath: ["services/simulator/src"],
    tests: ["services/simulator/tests"],
  },
  verifier: {
    venv: "services/verifier/.venv",
    requirements: ["services/verifier/requirements.txt"],
    pythonpath: ["services/verifier/src", "services/simulator/src"],
    tests: ["services/verifier/tests"],
  },
  validation: {
    venv: "services/validation/.venv",
    requirements: [
      "services/verifier/requirements.txt",
      "services/validation/requirements.lock",
    ],
    pythonpath: [
      "services/validation/src",
      "services/simulator/src",
      "services/verifier/src",
    ],
    tests: ["services/validation/tests", "-m", "not slow"],
  },
};

const groups = {
  core: ["ingest", "simulator"],
  verifier: ["verifier"],
  validation: ["validation"],
  all: ["ingest", "simulator", "verifier", "validation"],
};

const command = process.argv[2];
const group = process.argv[3] ?? "all";

if (!["setup", "test"].includes(command ?? "") || !(group in groups)) {
  console.error(
    "Usage: node scripts/python-services.mjs <setup|test> [core|verifier|validation|all]",
  );
  process.exit(2);
}

if (command === "setup") {
  const python = resolvePython();
  for (const name of groups[group]) setupService(name, python);
} else {
  for (const name of groups[group]) testService(name);
  if (group === "core" || group === "all") {
    testEvidenceSmoke();
  }
}

function setupService(name, python) {
  const service = services[name];
  const venvDir = abs(service.venv);
  if (!existsSync(venvPython(service.venv))) {
    run(python.command, [...python.args, "-m", "venv", venvDir]);
  }
  const py = venvPython(service.venv);
  run(py, ["-m", "pip", "install", "--upgrade", "pip"]);
  for (const requirements of service.requirements) {
    run(py, ["-m", "pip", "install", "--prefer-binary", "-r", abs(requirements)]);
  }
}

function testService(name) {
  const service = services[name];
  const py = venvPython(service.venv);
  assertVenv(name, py);
  const env = withPythonPath(service.pythonpath);
  run(py, ["-m", "pytest", ...service.tests], { env });
}

function testEvidenceSmoke() {
  const py = venvPython(services.ingest.venv);
  assertVenv("ingest", py);
  run(py, ["-m", "pytest", "packages/evidence/test_pytest_smoke.py"]);
}

function assertVenv(name, py) {
  if (!existsSync(py)) {
    throw new Error(
      `Missing ${name} Python venv at ${py}. Run pnpm setup:python first.`,
    );
  }
}

function resolvePython() {
  const candidates = [];
  if (process.env.PYTHON) candidates.push({ command: process.env.PYTHON, args: [] });
  if (isWindows) candidates.push({ command: "py", args: ["-3.12"] });
  candidates.push(
    { command: "python3.12", args: [] },
    { command: "python3", args: [] },
    { command: "python", args: [] },
  );

  for (const candidate of candidates) {
    const check = spawnSync(
      candidate.command,
      [
        ...candidate.args,
        "-c",
        "import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)",
      ],
      { encoding: "utf8" },
    );
    if (check.status === 0) return candidate;
  }
  throw new Error("Could not find Python 3.12+; install Python 3.12 and retry.");
}

function venvPython(venv) {
  return abs(join(venv, isWindows ? "Scripts/python.exe" : "bin/python"));
}

function withPythonPath(parts) {
  const extra = parts.map(abs).join(delimiter);
  return {
    ...process.env,
    PYTHONPATH: process.env.PYTHONPATH
      ? `${extra}${delimiter}${process.env.PYTHONPATH}`
      : extra,
  };
}

function abs(path) {
  return resolve(root, path);
}

function run(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    ...opts,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed with ${result.status}`);
  }
}
