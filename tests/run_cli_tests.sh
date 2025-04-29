#!/bin/bash
# Capture the first argument (e.g., --ci or --no-ci)
CI_MODE="$1"
PASS=()
FAIL=()
# Use regular arrays instead of associative arrays
FAIL_SCRIPTS=()
FAIL_OUTPUTS=()
# Add arrays for timing
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
  
  # Start timer
  START_TIME=$(date +%s)
  
  # Run the expect script directly with -f flag and show output in real-time
  /usr/bin/expect -f "$f" -- "$CI_MODE" 2>&1 | tee /tmp/expect_output.$$
  EXIT_CODE=${PIPESTATUS[0]}
  
  # End timer and calculate duration
  END_TIME=$(date +%s)
  DURATION=$((END_TIME - START_TIME))
  
  # Store test name and time
  TEST_NAMES+=("$f")
  TEST_TIMES+=("$DURATION")
  
  # Store output in a temporary file
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
  # Find the index of this test in the TEST_NAMES array
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
  # Find the index of this test in the TEST_NAMES array
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
    # Find the index of this test in the TEST_NAMES array
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

# Add time statistics
echo
echo "============== Timing Statistics =============="
# Sort tests by execution time (if sort is available)
if command -v sort &> /dev/null; then
  echo "Tests sorted by execution time (slowest first):"
  for i in "${!TEST_NAMES[@]}"; do
    echo "${TEST_TIMES[$i]}s ${TEST_NAMES[$i]}"
  done | sort -nr
  
  # Calculate total time
  TOTAL_TIME=0
  for t in "${TEST_TIMES[@]}"; do
    TOTAL_TIME=$((TOTAL_TIME + t))
  done
  echo
  echo "Total execution time: ${TOTAL_TIME}s"
fi
echo "================================================="