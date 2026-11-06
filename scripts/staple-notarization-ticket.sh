#!/usr/bin/env bash
set -Eeuo pipefail

artifact_path="${1:?Usage: staple-notarization-ticket.sh <app-or-dmg>}"
max_attempts=5

for ((attempt = 1; attempt <= max_attempts; attempt++)); do
    if xcrun stapler staple "${artifact_path}"; then
        exit 0
    else
        staple_status=$?
    fi

    # stapler returns EX_NOHOST (68) when its CloudKit ticket lookup fails.
    # Retry that service failure only; invalid artifacts and other errors fail
    # immediately. Notarization acceptance and ticket validation stay separate.
    if [[ "${staple_status}" -ne 68 || "${attempt}" -eq "${max_attempts}" ]]; then
        exit "${staple_status}"
    fi

    delay_seconds=$((attempt * 15))
    echo "Notarization ticket service unavailable; retrying in ${delay_seconds}s (${attempt}/${max_attempts})." >&2
    sleep "${delay_seconds}"
done
