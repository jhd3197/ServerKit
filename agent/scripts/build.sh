#!/bin/bash

# Build script for ServerKit Agent
# Cross-compiles for multiple platforms

set -e

# Get version from git or use default
VERSION=${VERSION:-$(git describe --tags --always --dirty 2>/dev/null || echo "dev")}
BUILD_TIME=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo "unknown")

# Build flags
LDFLAGS="-s -w -X main.Version=${VERSION} -X main.BuildTime=${BUILD_TIME} -X main.GitCommit=${GIT_COMMIT}"

# Output directory
DIST_DIR="dist"
mkdir -p ${DIST_DIR}

echo "Building ServerKit Agent ${VERSION}"
echo "Build time: ${BUILD_TIME}"
echo "Git commit: ${GIT_COMMIT}"
echo ""

# Build targets
TARGETS=(
    "linux/amd64"
    "linux/arm64"
    "linux/arm"
    "windows/amd64"
    "windows/arm64"
    "darwin/amd64"
    "darwin/arm64"
)

for target in "${TARGETS[@]}"; do
    GOOS=${target%/*}
    GOARCH=${target#*/}

    OUTPUT_NAME="serverkit-agent-${VERSION}-${GOOS}-${GOARCH}"
    if [ "${GOOS}" == "windows" ]; then
        OUTPUT_NAME="${OUTPUT_NAME}.exe"
    fi

    echo "Building ${GOOS}/${GOARCH}..."

    CGO_ENABLED=0 GOOS=${GOOS} GOARCH=${GOARCH} go build \
        -ldflags "${LDFLAGS}" \
        -o "${DIST_DIR}/${OUTPUT_NAME}" \
        ./cmd/agent

    # Calculate checksum
    if command -v sha256sum &> /dev/null; then
        sha256sum "${DIST_DIR}/${OUTPUT_NAME}" >> "${DIST_DIR}/checksums.txt"
    fi
done

echo ""
echo "Build complete! Binaries in ${DIST_DIR}/"
ls -la ${DIST_DIR}/
