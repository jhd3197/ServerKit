#!/bin/bash
# ============================================
# ServerKit - Docker App Routing Test Script
# ============================================
#
# Tests the full routing chain for a Docker application:
# 1. Port accessibility on localhost
# 2. Nginx configuration status
# 3. Direct backend HTTP request
# 4. Domain routing (if provided)
#
# Usage: ./test-routing.sh <app_name> <port> [domain]
#
# Examples:
#   ./test-routing.sh myapp 8080
#   ./test-routing.sh myapp 8080 myapp.example.com

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

APP_NAME=$1
PORT=$2
DOMAIN=$3

if [ -z "$APP_NAME" ] || [ -z "$PORT" ]; then
    echo "Usage: $0 <app_name> <port> [domain]"
    echo ""
    echo "Examples:"
    echo "  $0 myapp 8080"
    echo "  $0 myapp 8080 myapp.example.com"
    exit 1
fi

echo ""
echo "============================================"
echo " Testing routing for: $APP_NAME"
echo " Port: $PORT"
[ -n "$DOMAIN" ] && echo " Domain: $DOMAIN"
echo "============================================"
echo ""

PASS=0
FAIL=0

check() {
    local name=$1
    local result=$2
    if [ "$result" = "0" ]; then
        echo -e "  ${GREEN}✓${NC} $name"
        ((PASS++))
    else
        echo -e "  ${RED}✗${NC} $name"
        ((FAIL++))
    fi
}

# Test 1: Port accessibility
echo "1. Checking port accessibility..."
if command -v nc &> /dev/null; then
    nc -z -w 2 127.0.0.1 $PORT 2>/dev/null
    check "Port $PORT is accessible on localhost" $?
elif command -v curl &> /dev/null; then
    curl -s --connect-timeout 2 http://127.0.0.1:$PORT/ > /dev/null 2>&1
    check "Port $PORT is accessible on localhost" $?
else
    echo -e "  ${YELLOW}!${NC} Cannot check port (nc and curl not available)"
fi

# Test 2: Nginx configuration
echo ""
echo "2. Checking Nginx configuration..."

NGINX_AVAILABLE="/etc/nginx/sites-available/$APP_NAME"
NGINX_ENABLED="/etc/nginx/sites-enabled/$APP_NAME"

if [ -f "$NGINX_AVAILABLE" ]; then
    check "Config exists in sites-available" 0
else
    check "Config exists in sites-available" 1
    echo -e "     ${YELLOW}Hint: Config should be at $NGINX_AVAILABLE${NC}"
fi

if [ -L "$NGINX_ENABLED" ] || [ -f "$NGINX_ENABLED" ]; then
    check "Config is enabled (symlink in sites-enabled)" 0
else
    check "Config is enabled (symlink in sites-enabled)" 1
    echo -e "     ${YELLOW}Hint: Run 'sudo ln -s $NGINX_AVAILABLE $NGINX_ENABLED'${NC}"
fi

# Test 3: Nginx syntax
echo ""
echo "3. Testing Nginx configuration syntax..."
if command -v nginx &> /dev/null; then
    sudo nginx -t 2>&1 | grep -q "successful"
    check "Nginx config syntax is valid" $?
else
    echo -e "  ${YELLOW}!${NC} Nginx command not available"
fi

# Test 4: Nginx service status
echo ""
echo "4. Checking Nginx service status..."
if command -v systemctl &> /dev/null; then
    systemctl is-active nginx > /dev/null 2>&1
    check "Nginx service is running" $?
else
    ps aux | grep -v grep | grep -q nginx
    check "Nginx process is running" $?
fi

# Test 5: Direct backend request
echo ""
echo "5. Testing direct backend request..."
if command -v curl &> /dev/null; then
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 http://127.0.0.1:$PORT/ 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" != "000" ]; then
        check "Backend responds (HTTP $HTTP_CODE)" 0
    else
        check "Backend responds" 1
        echo -e "     ${YELLOW}Hint: Container may not be running or port may not be exposed${NC}"
    fi
else
    echo -e "  ${YELLOW}!${NC} curl not available"
fi

# Test 6: Domain routing (if provided)
if [ -n "$DOMAIN" ]; then
    echo ""
    echo "6. Testing domain routing..."
    if command -v curl &> /dev/null; then
        # Test via Host header to localhost (simulates domain routing)
        HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 -H "Host: $DOMAIN" http://127.0.0.1/ 2>/dev/null || echo "000")
        if [ "$HTTP_CODE" != "000" ] && [ "$HTTP_CODE" != "404" ]; then
            check "Domain routing works (HTTP $HTTP_CODE)" 0
        else
            check "Domain routing works" 1
            echo -e "     ${YELLOW}Hint: Check that the domain is in the Nginx server_name directive${NC}"
        fi
    fi
fi

# Test 7: Docker container status
echo ""
echo "7. Checking Docker container status..."
if command -v docker &> /dev/null; then
    CONTAINER_STATUS=$(docker ps --filter "name=$APP_NAME" --format "{{.Status}}" 2>/dev/null | head -1)
    if [ -n "$CONTAINER_STATUS" ]; then
        if echo "$CONTAINER_STATUS" | grep -qi "up"; then
            check "Container is running: $CONTAINER_STATUS" 0
        else
            check "Container is running" 1
            echo -e "     ${YELLOW}Status: $CONTAINER_STATUS${NC}"
        fi
    else
        check "Container found" 1
        echo -e "     ${YELLOW}Hint: No container named '$APP_NAME' found${NC}"
    fi

    # Check port bindings
    PORT_BINDINGS=$(docker port "$APP_NAME" 2>/dev/null || echo "")
    if [ -n "$PORT_BINDINGS" ]; then
        echo -e "     Port bindings:"
        echo "$PORT_BINDINGS" | while read line; do
            echo -e "       $line"
        done
    fi
else
    echo -e "  ${YELLOW}!${NC} Docker command not available"
fi

# Summary
echo ""
echo "============================================"
echo " Summary"
echo "============================================"
echo -e " ${GREEN}Passed:${NC} $PASS"
echo -e " ${RED}Failed:${NC} $FAIL"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}All checks passed! Routing should be working.${NC}"
    exit 0
else
    echo -e "${RED}Some checks failed. Review the issues above.${NC}"
    echo ""
    echo "Common fixes:"
    echo "  - Start the container: docker compose up -d"
    echo "  - Create Nginx config: Use ServerKit domains API"
    echo "  - Enable Nginx config: sudo ln -s /etc/nginx/sites-available/$APP_NAME /etc/nginx/sites-enabled/"
    echo "  - Reload Nginx: sudo systemctl reload nginx"
    exit 1
fi
