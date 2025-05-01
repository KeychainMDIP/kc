#!/usr/bin/env bash
set -e

# Capture the first argument (e.g., --ci-json or --local)
CI_MODE="$1"
PASS=()
FAIL=()
FAIL_SCRIPTS=()
FAIL_OUTPUTS=()
TEST_NAMES=()
TEST_TIMES=()

SCRIPT_DIR="./cli-tests"
shopt -s nullglob
scripts=("$SCRIPT_DIR"/*.expect)

if [ ${#scripts[@]} -eq 0 ]; then
  echo "No .expect scripts found in $SCRIPT_DIR"
  exit 1
fi

echo "Running expect scripts from $SCRIPT_DIR..."
echo

for f in "${scripts[@]}"; do
  echo "----------------------------------------"
  echo "Running $f..."

  START_TIME=$(date +%s)

  /usr/bin/expect -f "$f" -- "$CI_MODE" 2>&1 | tee /tmp/expect_output.$$
  EXIT_CODE=${PIPESTATUS[0]}

  END_TIME=$(date +%s)
  DURATION=$((END_TIME - START_TIME))

  TEST_NAMES+=("$f")
  TEST_TIMES+=("$DURATION")

  OUTPUT=$(cat /tmp/expect_output.$$)
  rm -f /tmp/expect_output.$$

  if [ "$EXIT_CODE" -eq 0 ]; then
    echo "[PASS] $f (${DURATION}s)"
    PASS+=("$f")
  else
    echo "[FAIL] $f (${DURATION}s)"
    FAIL+=("$f")
    FAIL_SCRIPTS+=("$f")
    FAIL_OUTPUTS+=("$OUTPUT")
  fi
done

echo
echo "==================== Summary ===================="
echo "✅ Passed: ${#PASS[@]}"
for f in "${PASS[@]}"; do
  for i in "${!TEST_NAMES[@]}"; do
    if [ "${TEST_NAMES[$i]}" = "$f" ]; then
      echo "  ✔️  $f (${TEST_TIMES[$i]}s)"
      break
    fi
  done
done

echo
echo "❌ Failed: ${#FAIL[@]}"
for f in "${FAIL[@]}"; do
  for i in "${!TEST_NAMES[@]}"; do
    if [ "${TEST_NAMES[$i]}" = "$f" ]; then
      echo "  ❌ $f (${TEST_TIMES[$i]}s)"
      break
    fi
  done
done

if [ "${#FAIL[@]}" -gt 0 ]; then
  echo
  echo "============== Failed Script Output ============="
  for i in "${!FAIL_SCRIPTS[@]}"; do
    for j in "${!TEST_NAMES[@]}"; do
      if [ "${TEST_NAMES[$j]}" = "${FAIL_SCRIPTS[$i]}" ]; then
        echo
        echo "❌ Output for: ${FAIL_SCRIPTS[$i]} (${TEST_TIMES[$j]}s)"
        break
      fi
    done
    echo "----------------------------------------"
    echo "${FAIL_OUTPUTS[$i]}"
    echo "----------------------------------------"
  done
fi

echo
echo "============== Timing Statistics =============="
if command -v sort &> /dev/null; then
  echo "Tests sorted by execution time (slowest first):"
  for i in "${!TEST_NAMES[@]}"; do
    echo "${TEST_TIMES[$i]}s ${TEST_NAMES[$i]}"
  done | sort -nr

  TOTAL_TIME=0
  for t in "${TEST_TIMES[@]}"; do
    TOTAL_TIME=$((TOTAL_TIME + t))
  done
  echo
  echo "Total execution time: ${TOTAL_TIME}s"
fi
echo "================================================="

# Final exit based on failures
if [ "${#FAIL[@]}" -gt 0 ]; then
  exit 1
else
  exit 0
fi
