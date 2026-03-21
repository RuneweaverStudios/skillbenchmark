# Benchmark runner container — sandboxed environment for executing
# benchmark scenarios with agent loops. NO network access at runtime.
FROM python:3.12-slim

# Install Node.js for Claude CLI and JS-based tools
RUN apt-get update && \
    apt-get install -y curl git && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install Claude CLI globally
RUN npm install -g @anthropic-ai/claude-code

# Install Python dependencies for the harness
COPY requirements.txt /app/
RUN pip install --no-cache-dir -r /app/requirements.txt

# Copy benchmark harness
COPY harness/ /app/harness/

# Create non-root user
RUN useradd -m -s /bin/bash runner
USER runner

WORKDIR /workspace

ENTRYPOINT ["python", "/app/harness/run_benchmark.py"]
