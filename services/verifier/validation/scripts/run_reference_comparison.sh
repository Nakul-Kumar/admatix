#!/usr/bin/env bash
# Build an ISOLATED venv and run the reference libraries the verifier
# dropped (tfcausalimpact, obp) on the same fixtures the bespoke
# estimators already consumed. Writes _reference_bsts.json and
# _reference_ope.json next to the fixtures.
#
# Two separate venvs because tfcausalimpact pulls TensorFlow and obp pulls
# scikit-learn + pyro — running them together drags in conflicting transitive
# pins for absl-py / numpy.
set -euo pipefail

# script lives at  services/verifier/validation/scripts/run_reference_comparison.sh
# VALIDATION_DIR =  services/verifier/validation
# VERIFIER_DIR   =  services/verifier
VALIDATION_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERIFIER_DIR="$(cd "${VALIDATION_DIR}/.." && pwd)"
PYBIN="${PYBIN:-python3.12}"

run_one () {
  local kind="$1"          # bsts | ope
  local pkg="$2"           # pip install spec for the reference lib
  local venv=".refvenv_${kind}"
  echo "== reference ${kind}: building ${venv} =="
  ${PYBIN} -m venv "${VALIDATION_DIR}/${venv}"
  # shellcheck disable=SC1091
  source "${VALIDATION_DIR}/${venv}/bin/activate"
  pip install --quiet --upgrade pip
  pip install --quiet "${pkg}" "pandas<2.2"
  echo "== reference ${kind}: running on fixtures =="
  ( cd "${VERIFIER_DIR}" && python -m validation.reference_on_fixtures "${kind}" )
  deactivate
}

run_one bsts "tfcausalimpact==0.0.18"
run_one ope  "obp==0.5.7"

echo "== reference comparison: done =="
ls -1 "${VALIDATION_DIR}/_fixtures/" | grep -E '^_reference' || true
