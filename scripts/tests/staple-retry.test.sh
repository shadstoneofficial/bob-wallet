#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd "$(dirname "$0")/../.." && pwd)"
fixture_dir="$(mktemp -d)"
trap 'rm -rf "${fixture_dir}"' EXIT
mkdir "${fixture_dir}/bin"
export COUNT_FILE="${fixture_dir}/count"
export SLEEP_FILE="${fixture_dir}/sleeps"
export TEST_ARTIFACT="${fixture_dir}/Bob LearnHNS.app"
export PATH="${fixture_dir}/bin:${PATH}"

cat > "${fixture_dir}/bin/xcrun" <<'STUB'
#!/usr/bin/env bash
set -eu
[[ "$#" -eq 3 && "$1" == stapler && "$2" == staple && "$3" == "$TEST_ARTIFACT" ]] || exit 99
count=$(cat "$COUNT_FILE")
count=$((count + 1))
echo "$count" > "$COUNT_FILE"
if [[ "$count" -le "$FAIL_UNTIL" ]]; then exit "$FAIL_CODE"; fi
STUB
cat > "${fixture_dir}/bin/sleep" <<'STUB'
#!/usr/bin/env bash
echo "$1" >> "$SLEEP_FILE"
STUB
chmod +x "${fixture_dir}/bin/xcrun" "${fixture_dir}/bin/sleep"

run_case() {
    export FAIL_UNTIL="$1" FAIL_CODE="$2"
    local expected_status="$3" expected_calls="$4" expected_delays="$5" actual_status
    echo 0 > "$COUNT_FILE"
    : > "$SLEEP_FILE"
    if bash "${repo_root}/scripts/staple-notarization-ticket.sh" "$TEST_ARTIFACT"; then
        actual_status=0
    else
        actual_status=$?
    fi
    [[ "$actual_status" -eq "$expected_status" ]]
    [[ "$(cat "$COUNT_FILE")" -eq "$expected_calls" ]]
    [[ "$(paste -sd, "$SLEEP_FILE")" == "$expected_delays" ]]
}

run_case 0 68 0 1 ''
run_case 2 68 0 3 '15,30'
run_case 10 68 68 5 '15,30,45,60'
run_case 10 65 65 1 ''
echo 'Stapling retry tests passed: first success, transient recovery, exhaustion, permanent failure, and spaced paths.'
