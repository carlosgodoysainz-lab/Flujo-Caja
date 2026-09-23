#!/usr/bin/env bash
# ============================================================
# Forge — Tool Usage Tracker Hook (PostToolUse)
# ============================================================
# Counts tool INVOCATIONS per session and keeps a running top-5.
#
# ⚠️  This is NOT a cost meter. It records how many times each tool
#     ran — it does NOT measure tokens or dollars. A PostToolUse hook
#     has no access to token or billing data, so monetary cost is
#     reported as n/a, never fabricated. (Issue #3, point 5:
#     "sin métricas inventadas" — no invented metrics.)
#
# Appends structured entries to tool-usage-stats.log. Never blocks.
# ============================================================

# Fail-open: on any unexpected error, return success
trap 'printf "{}\n"; exit 0' ERR

# Read hook input from stdin
HOOK_INPUT=$(cat)

# Extract tool name
TOOL_NAME=$(echo "$HOOK_INPUT" | grep -o '"tool_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed 's/.*"tool_name"[[:space:]]*:[[:space:]]*"//' | sed 's/"//')
[ -z "$TOOL_NAME" ] && TOOL_NAME="unknown"

# Create logs directory
mkdir -p .claude/logs

# Session ID: use date-based (one log per day)
SESSION_DATE=$(date '+%Y-%m-%d')
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Append one line per invocation
LOG_FILE=".claude/logs/tool-usage-stats.log"
echo "[$TIMESTAMP] tool=$TOOL_NAME" >> "$LOG_FILE"

# Every 50 invocations, append a top-5 usage summary (counts, not cost)
LINE_COUNT=$(wc -l < "$LOG_FILE" 2>/dev/null | tr -d ' ')
if [ "$((LINE_COUNT % 50))" -eq 0 ] && [ "$LINE_COUNT" -gt 0 ]; then
  TOOL_SUMMARY=$(grep "\[$SESSION_DATE" "$LOG_FILE" 2>/dev/null | grep -o 'tool=[^ ]*' | sort | uniq -c | sort -rn | head -5)
  echo "--- Session $SESSION_DATE tool-usage summary (top 5 by count): $TOOL_SUMMARY ---" >> "$LOG_FILE"
fi

# Always return success
printf '{}\n'
