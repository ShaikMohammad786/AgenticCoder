#!/bin/bash
# Example plugin handler — reads PLUGIN_INPUT env var (JSON)
NAME=$(echo "$PLUGIN_INPUT" | grep -o '"name":"[^"]*"' | cut -d'"' -f4)
echo "Hello, ${NAME:-World}! This is a plugin response from AgenticCoder."
echo "Project directory: $PROJECT_DIR"
