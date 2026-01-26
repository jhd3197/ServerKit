#!/bin/bash
# Start both backend and frontend

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "Starting ServerKit..."
echo "  Backend:  http://localhost:5000"
echo "  Frontend: http://localhost:5173"
echo ""

cd "$PROJECT_ROOT/backend"
source venv/bin/activate
python run.py &
BACKEND_PID=$!

sleep 2

cd "$PROJECT_ROOT/frontend"
npm run dev &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
