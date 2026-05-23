#!/bin/bash
# AdMatix build metrics — per-package LOC, tests, files. Read-only on the repo;
# appends a JSON snapshot to .build/metrics.jsonl and rewrites .build/METRICS.md.
export HOME=/home/agentforge
cd /opt/admatix 2>/dev/null || exit 1
mkdir -p .build
TS=$(date -u +%FT%TZ)
COMMIT=$(git rev-parse --short HEAD 2>/dev/null)
mapfile -t FILES < <(git ls-files '*.ts' '*.tsx' '*.py' '*.sql' '*.js' 2>/dev/null | grep -vE 'node_modules|/dist/|/\.turbo/')
TOTAL=0; TESTLOC=0; NFILES=${#FILES[@]}; NTEST=0
declare -A PKGLOC
for f in "${FILES[@]}"; do
  [ -f "$f" ] || continue
  L=$(wc -l < "$f" 2>/dev/null); L=${L:-0}
  TOTAL=$((TOTAL + L))
  PKG=$(echo "$f" | awk -F/ '{ if ($1=="packages"||$1=="apps"||$1=="services") print $1"/"$2; else print $1 }')
  PKGLOC[$PKG]=$(( ${PKGLOC[$PKG]:-0} + L ))
  if echo "$f" | grep -qE '\.(test|spec)\.|/tests?/|_test\.py'; then NTEST=$((NTEST+1)); TESTLOC=$((TESTLOC+L)); fi
done
PKGJSON="{"; first=1
for k in "${!PKGLOC[@]}"; do [ $first -eq 0 ] && PKGJSON+=","; PKGJSON+="\"$k\":${PKGLOC[$k]}"; first=0; done
PKGJSON+="}"
echo "{\"ts\":\"$TS\",\"commit\":\"$COMMIT\",\"total_loc\":$TOTAL,\"files\":$NFILES,\"test_files\":$NTEST,\"test_loc\":$TESTLOC,\"by_package\":$PKGJSON}" >> .build/metrics.jsonl
{
  echo "# AdMatix Build Metrics"
  echo ""
  echo "**$TS** · commit \`$COMMIT\`"
  echo ""
  echo "Total code: **$TOTAL LOC** across **$NFILES files** · tests: **$NTEST files / $TESTLOC LOC**"
  echo ""
  echo "## By package / area"
  for k in $(echo "${!PKGLOC[@]}" | tr ' ' '\n' | sort); do
    printf -- "- \`%s\`: %s LOC\n" "$k" "${PKGLOC[$k]}"
  done
  echo ""
  echo "_Time series: \`.build/metrics.jsonl\` ($(wc -l < .build/metrics.jsonl 2>/dev/null) snapshots). Updated every 30 min by cron \`admatix-metrics\`._"
} > .build/METRICS.md
echo "metrics @ $COMMIT: $TOTAL LOC, $NFILES files, $NTEST test files"
