# ServerKit Agent Makefile

VERSION ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo "dev")
BUILD_TIME ?= $(shell date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_COMMIT ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo "unknown")

LDFLAGS := -s -w \
	-X main.Version=$(VERSION) \
	-X main.BuildTime=$(BUILD_TIME) \
	-X main.GitCommit=$(GIT_COMMIT)

BINARY_NAME := serverkit-agent
DIST_DIR := dist

.PHONY: all build clean test lint deps dev run docker-build docker-push docker-buildx

all: build

# Download dependencies
deps:
	go mod download
	go mod tidy

# Build for current platform
build:
	CGO_ENABLED=0 go build -ldflags "$(LDFLAGS)" -o $(BINARY_NAME) ./cmd/agent

# Build for current platform with debug symbols
dev:
	go build -o $(BINARY_NAME) ./cmd/agent

# Run the agent
run: build
	./$(BINARY_NAME) start

# Build for all platforms
build-all:
	@mkdir -p $(DIST_DIR)
	@echo "Building for Linux amd64..."
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o $(DIST_DIR)/$(BINARY_NAME)-$(VERSION)-linux-amd64 ./cmd/agent
	@echo "Building for Linux arm64..."
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o $(DIST_DIR)/$(BINARY_NAME)-$(VERSION)-linux-arm64 ./cmd/agent
	@echo "Building for Windows amd64..."
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o $(DIST_DIR)/$(BINARY_NAME)-$(VERSION)-windows-amd64.exe ./cmd/agent
	@echo "Building for Windows arm64..."
	CGO_ENABLED=0 GOOS=windows GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o $(DIST_DIR)/$(BINARY_NAME)-$(VERSION)-windows-arm64.exe ./cmd/agent
	@echo "Building for macOS amd64..."
	CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o $(DIST_DIR)/$(BINARY_NAME)-$(VERSION)-darwin-amd64 ./cmd/agent
	@echo "Building for macOS arm64..."
	CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o $(DIST_DIR)/$(BINARY_NAME)-$(VERSION)-darwin-arm64 ./cmd/agent
	@echo "Done! Binaries in $(DIST_DIR)/"

# Build Linux only
build-linux:
	@mkdir -p $(DIST_DIR)
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o $(DIST_DIR)/$(BINARY_NAME)-linux-amd64 ./cmd/agent
	CGO_ENABLED=0 GOOS=linux GOARCH=arm64 go build -ldflags "$(LDFLAGS)" -o $(DIST_DIR)/$(BINARY_NAME)-linux-arm64 ./cmd/agent

# Build Windows only
build-windows:
	@mkdir -p $(DIST_DIR)
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -ldflags "$(LDFLAGS)" -o $(DIST_DIR)/$(BINARY_NAME)-windows-amd64.exe ./cmd/agent

# Run tests
test:
	go test -v ./...

# Run tests with coverage
test-coverage:
	go test -v -coverprofile=coverage.out ./...
	go tool cover -html=coverage.out -o coverage.html

# Run linter
lint:
	golangci-lint run ./...

# Format code
fmt:
	go fmt ./...

# Clean build artifacts
clean:
	rm -f $(BINARY_NAME)
	rm -rf $(DIST_DIR)
	rm -f coverage.out coverage.html

# Install locally
install: build
	cp $(BINARY_NAME) /usr/local/bin/

# Create checksums
checksums:
	@cd $(DIST_DIR) && sha256sum * > checksums.txt

# Docker image name
DOCKER_IMAGE := serverkit/agent
DOCKER_TAG ?= latest

# Build Docker image
docker-build:
	docker build \
		--build-arg VERSION=$(VERSION) \
		--build-arg BUILD_TIME=$(BUILD_TIME) \
		--build-arg GIT_COMMIT=$(GIT_COMMIT) \
		-t $(DOCKER_IMAGE):$(DOCKER_TAG) .

# Build and tag Docker image with version
docker-build-version: docker-build
	docker tag $(DOCKER_IMAGE):$(DOCKER_TAG) $(DOCKER_IMAGE):$(VERSION)

# Push Docker image
docker-push:
	docker push $(DOCKER_IMAGE):$(DOCKER_TAG)
	docker push $(DOCKER_IMAGE):$(VERSION)

# Build multi-arch Docker image
docker-buildx:
	docker buildx build \
		--platform linux/amd64,linux/arm64 \
		--build-arg VERSION=$(VERSION) \
		--build-arg BUILD_TIME=$(BUILD_TIME) \
		--build-arg GIT_COMMIT=$(GIT_COMMIT) \
		-t $(DOCKER_IMAGE):$(DOCKER_TAG) \
		-t $(DOCKER_IMAGE):$(VERSION) \
		--push .

# Help
help:
	@echo "ServerKit Agent Build System"
	@echo ""
	@echo "Usage: make [target]"
	@echo ""
	@echo "Targets:"
	@echo "  build           Build for current platform"
	@echo "  build-all       Build for all platforms"
	@echo "  build-linux     Build for Linux only"
	@echo "  build-windows   Build for Windows only"
	@echo "  dev             Build with debug symbols"
	@echo "  run             Build and run the agent"
	@echo "  test            Run tests"
	@echo "  lint            Run linter"
	@echo "  fmt             Format code"
	@echo "  clean           Remove build artifacts"
	@echo "  deps            Download dependencies"
	@echo "  install         Install to /usr/local/bin"
	@echo ""
	@echo "Docker:"
	@echo "  docker-build    Build Docker image"
	@echo "  docker-push     Push Docker image to registry"
	@echo "  docker-buildx   Build multi-arch image (amd64, arm64)"
	@echo ""
	@echo "  help            Show this help"
