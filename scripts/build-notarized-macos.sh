#!/usr/bin/env bash
set -Eeuo pipefail

APP_NAME="Bob LearnHNS"
APP_BUNDLE_NAME="${APP_NAME}.app"
PRODUCT_NAME="Bob LearnHNS"
VERSION="$(node -p "require('./package.json').version")"
OUTPUT_DIR="release"
NOTARY_MAX_ATTEMPTS="${NOTARY_MAX_ATTEMPTS:-240}"
NOTARY_SLEEP_SECONDS="${NOTARY_SLEEP_SECONDS:-30}"
MAC_ARCHES_INPUT="${MAC_ARCHES:-x64 arm64}"
IFS=' ' read -r -a MAC_ARCHES <<< "${MAC_ARCHES_INPUT}"

require_env() {
    local name="$1"
    if [[ -z "${!name:-}" ]]; then
        echo "Missing required environment variable: ${name}" >&2
        exit 1
    fi
}

developer_id_identity() {
    if [[ -n "${DMG_SIGN_IDENTITY:-}" ]]; then
        printf '%s\n' "${DMG_SIGN_IDENTITY}"
        return
    fi

    security find-identity -v -p codesigning \
        | awk -F '"' '/Developer ID Application/ { print $2; exit }'
}

if [[ "$(uname -s)" != "Darwin" ]]; then
    echo "macOS notarization must run on macOS." >&2
    exit 1
fi

NOTARY_ARGS=()
if [[ -n "${NOTARY_KEYCHAIN_PROFILE:-}" ]]; then
    NOTARY_ARGS=(--keychain-profile "${NOTARY_KEYCHAIN_PROFILE}")
else
    require_env "APPLE_ID"
    require_env "APPLE_APP_SPECIFIC_PASSWORD"
    require_env "APPLE_TEAM_ID"
    NOTARY_ARGS=(--apple-id "${APPLE_ID}" --password "${APPLE_APP_SPECIFIC_PASSWORD}" --team-id "${APPLE_TEAM_ID}")
fi

rm -rf "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}/notary" "${OUTPUT_DIR}/dmg-stage"

echo "Building renderer/main assets for ${PRODUCT_NAME} ${VERSION}"
npm run build

echo "Building signed macOS app bundles for ${PRODUCT_NAME} ${VERSION}"
for arch in "${MAC_ARCHES[@]}"; do
    case "${arch}" in
        x64|arm64)
            npx electron-builder --mac dir "--${arch}" --publish=never
            ;;
        *)
            echo "Unsupported macOS arch: ${arch}" >&2
            exit 1
            ;;
    esac
done

notary_json_value() {
    local file="$1"
    local key="$2"
    node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const value = data[process.argv[2]];
if (value === undefined || value === null) process.exit(1);
console.log(value);
" "$file" "$key"
}

submit_artifact_for_notarization() {
    local artifact_path="$1"
    local label="$2"
    local submit_path="$3"
    local submit_output="${OUTPUT_DIR}/notary/${label}-submit.json"

    if [[ -n "${submit_path}" ]]; then
        echo "Creating notarization zip: ${submit_path}"
        rm -f "${submit_path}"
        ditto -c -k --sequesterRsrc --keepParent "${artifact_path}" "${submit_path}"
    else
        submit_path="${artifact_path}"
    fi

    echo "Submitting ${label} for notarization"
    xcrun notarytool submit "${submit_path}" \
        "${NOTARY_ARGS[@]}" \
        --output-format json | tee "${submit_output}"

    local submission_id
    submission_id="$(notary_json_value "${submit_output}" id)"
    echo "Notary submission ID (${label}): ${submission_id}"
}

poll_notarization() {
    local label="$1"
    local submit_output="${OUTPUT_DIR}/notary/${label}-submit.json"
    local info_output="${OUTPUT_DIR}/notary/${label}-info.json"
    local log_output="${OUTPUT_DIR}/notary/${label}-notary-log.json"
    local submission_id
    submission_id="$(notary_json_value "${submit_output}" id)"

    local status=""
    local attempt=1
    while [[ "${attempt}" -le "${NOTARY_MAX_ATTEMPTS}" ]]; do
        echo "Polling notarization status for ${label}, attempt ${attempt}/${NOTARY_MAX_ATTEMPTS}"

        if xcrun notarytool info "${submission_id}" \
            "${NOTARY_ARGS[@]}" \
            --output-format json > "${info_output}"; then
            cat "${info_output}"
            status="$(notary_json_value "${info_output}" status || true)"
        else
            echo "notarytool info failed; retrying after ${NOTARY_SLEEP_SECONDS}s" >&2
            status=""
        fi

        case "${status}" in
            Accepted)
                echo "Notarization accepted for ${label}"
                break
                ;;
            Invalid|Rejected)
                echo "Notarization ${status} for ${label}; fetching notary log" >&2
                xcrun notarytool log "${submission_id}" \
                    "${NOTARY_ARGS[@]}" \
                    --output-format json | tee "${log_output}" || true
                exit 1
                ;;
            *)
                sleep "${NOTARY_SLEEP_SECONDS}"
                ;;
        esac

        attempt=$((attempt + 1))
    done

    if [[ "${status}" != "Accepted" ]]; then
        echo "Timed out waiting for notarization acceptance for ${label}; fetching latest notary log if available" >&2
        xcrun notarytool log "${submission_id}" \
            "${NOTARY_ARGS[@]}" \
            --output-format json | tee "${log_output}" || true
        exit 1
    fi
}

submit_app_for_notarization() {
    local app_path="$1"
    local arch="$2"
    local zip_path="${OUTPUT_DIR}/notary/${PRODUCT_NAME}-${VERSION}-${arch}.zip"

    echo "Verifying code signature before app notarization: ${app_path}"
    codesign --verify --deep --strict --verbose=2 "${app_path}"
    submit_artifact_for_notarization "${app_path}" "${arch}" "${zip_path}"
}

staple_and_verify_app() {
    local app_path="$1"
    local arch="$2"
    echo "Stapling notarization ticket for ${arch}: ${app_path}"
    xcrun stapler staple "${app_path}"
    xcrun stapler validate "${app_path}"

    echo "Verifying Gatekeeper assessment for ${arch}"
    spctl --assess --type execute --verbose "${app_path}"
}

create_dmg() {
    local app_path="$1"
    local arch="$2"
    local dmg_path="${OUTPUT_DIR}/${PRODUCT_NAME}-${VERSION}-${arch}.dmg"
    local stage_dir="${OUTPUT_DIR}/dmg-stage/${arch}"

    rm -rf "${stage_dir}" "${dmg_path}"
    mkdir -p "${stage_dir}"
    cp -R "${app_path}" "${stage_dir}/${APP_BUNDLE_NAME}"
    ln -s /Applications "${stage_dir}/Applications"

    echo "Creating DMG: ${dmg_path}"
    hdiutil create \
        -volname "${PRODUCT_NAME}" \
        -srcfolder "${stage_dir}" \
        -ov \
        -format UDZO \
        "${dmg_path}"

    local identity
    identity="$(developer_id_identity)"
    if [[ -z "${identity}" ]]; then
        echo "No Developer ID Application identity found for DMG signing." >&2
        exit 1
    fi

    echo "Signing DMG with ${identity}: ${dmg_path}"
    codesign --force --sign "${identity}" "${dmg_path}"
    codesign --verify --verbose=2 "${dmg_path}"
    hdiutil verify "${dmg_path}"

    submit_artifact_for_notarization "${dmg_path}" "${arch}-dmg" ""
    poll_notarization "${arch}-dmg"

    echo "Stapling notarization ticket for ${arch} DMG: ${dmg_path}"
    xcrun stapler staple "${dmg_path}"
    xcrun stapler validate "${dmg_path}"
    spctl --assess --type open --context context:primary-signature --verbose "${dmg_path}"
}

app_path_for_arch() {
    case "$1" in
        x64)
            printf '%s\n' "${OUTPUT_DIR}/mac/${APP_BUNDLE_NAME}"
            ;;
        arm64)
            printf '%s\n' "${OUTPUT_DIR}/mac-arm64/${APP_BUNDLE_NAME}"
            ;;
        *)
            echo "Unsupported macOS arch: $1" >&2
            exit 1
            ;;
    esac
}

for arch in "${MAC_ARCHES[@]}"; do
    app_path="$(app_path_for_arch "${arch}")"
    if [[ ! -d "${app_path}" ]]; then
        echo "Expected app bundle not found: ${app_path}" >&2
        exit 1
    fi

    submit_app_for_notarization "${app_path}" "${arch}"
done

for arch in "${MAC_ARCHES[@]}"; do
    poll_notarization "${arch}"
done

for arch in "${MAC_ARCHES[@]}"; do
    app_path="$(app_path_for_arch "${arch}")"
    staple_and_verify_app "${app_path}" "${arch}"
    create_dmg "${app_path}" "${arch}"
done

echo "Signed, notarized, stapled, and packaged macOS DMGs:"
ls -lh "${OUTPUT_DIR}"/*.dmg
