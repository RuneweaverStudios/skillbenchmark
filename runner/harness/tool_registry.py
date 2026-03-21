"""
Simulated tool registry for benchmark scenarios.
Provides realistic tool outputs that grow progressively to test
context management and token efficiency.
"""

import json
import time
from typing import Any


class ToolRegistry:
    """Registry of simulated tools that return realistic output."""

    def __init__(self):
        self._call_count = 0
        self._handlers: dict[str, Any] = {
            "read_file": self._read_file,
            "search_files": self._search_files,
            "list_directory": self._list_directory,
            "run_command": self._run_command,
            "query_database": self._query_database,
            "fetch_url": self._fetch_url,
            "get_logs": self._get_logs,
            "get_config": self._get_config,
        }

    def execute(self, tool_name: str, args: dict) -> str:
        """Execute a simulated tool and return realistic output."""
        self._call_count += 1
        handler = self._handlers.get(tool_name, self._generic_handler)
        result = handler(args)
        return json.dumps(result, indent=2)

    def _read_file(self, args: dict) -> dict:
        path = args.get("path", "unknown.txt")
        # Progressively larger files
        line_count = min(50 + self._call_count * 10, 500)
        lines = [
            f"line {i}: content of {path} - "
            f"{'important data here ' * (3 if i % 7 == 0 else 1)}"
            for i in range(line_count)
        ]
        return {"path": path, "content": "\n".join(lines), "size": len("\n".join(lines))}

    def _search_files(self, args: dict) -> dict:
        pattern = args.get("pattern", "*")
        count = min(10 + self._call_count * 5, 100)
        return {
            "pattern": pattern,
            "matches": [
                {"path": f"src/module_{i}/{pattern}.ts", "line": i * 10, "match": f"Found {pattern} at line {i * 10}"}
                for i in range(count)
            ],
            "total": count,
        }

    def _list_directory(self, args: dict) -> dict:
        path = args.get("path", ".")
        count = min(20 + self._call_count * 3, 200)
        return {
            "path": path,
            "entries": [
                {"name": f"file_{i}.ts", "size": 1024 * (i + 1), "type": "file" if i % 3 else "directory"}
                for i in range(count)
            ],
        }

    def _run_command(self, args: dict) -> dict:
        cmd = args.get("command", "echo hello")
        # Simulate command output that grows with complexity
        output_lines = min(30 + self._call_count * 8, 300)
        return {
            "command": cmd,
            "exit_code": 0,
            "stdout": "\n".join([f"[{time.strftime('%H:%M:%S')}] Output line {i}: {cmd}" for i in range(output_lines)]),
            "stderr": "",
        }

    def _query_database(self, args: dict) -> dict:
        query = args.get("query", "SELECT 1")
        row_count = min(10 + self._call_count * 3, 50)
        return {
            "query": query,
            "rows": [
                {"id": i, "name": f"record_{i}", "value": i * 42, "created_at": "2024-01-01T00:00:00Z"}
                for i in range(row_count)
            ],
            "row_count": row_count,
        }

    def _fetch_url(self, args: dict) -> dict:
        url = args.get("url", "https://example.com")
        return {
            "url": url,
            "status": 200,
            "body": f"Response from {url}. " * min(50 + self._call_count * 20, 500),
            "headers": {"content-type": "application/json"},
        }

    def _get_logs(self, args: dict) -> dict:
        service = args.get("service", "app")
        line_count = min(50 + self._call_count * 15, 500)
        return {
            "service": service,
            "lines": [
                f"[2024-01-01T{i:02d}:00:00Z] [{['INFO', 'WARN', 'ERROR'][i % 3]}] "
                f"{service}: Log message {i} - {'stack trace here ' * (5 if i % 10 == 0 else 0)}"
                for i in range(line_count)
            ],
        }

    def _get_config(self, args: dict) -> dict:
        name = args.get("name", "app")
        return {
            "name": name,
            "config": {
                "database": {"host": "localhost", "port": 5432, "name": f"{name}_db"},
                "redis": {"host": "localhost", "port": 6379},
                "features": {f"feature_{i}": i % 2 == 0 for i in range(20)},
                "logging": {"level": "info", "format": "json"},
            },
        }

    def _generic_handler(self, args: dict) -> dict:
        return {
            "status": "ok",
            "data": args,
            "call_number": self._call_count,
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
