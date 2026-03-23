FROM node:22-slim

# Install system deps in a single layer
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    git \
    curl \
    bash \
    jq \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Ensure common bins are on PATH
ENV PATH="/usr/local/bin:/usr/bin:/usr/sbin:/bin:${PATH}"

# Set up directories
RUN mkdir -p /app /benchmark /tmp/workspace
WORKDIR /app

# Copy the agent runner (standalone, zero deps)
COPY agent-runner.js /app/agent-runner.js

# /benchmark is bind-mounted at runtime with config.json
# Output is written to /benchmark/output.json
ENTRYPOINT ["node", "/app/agent-runner.js"]
