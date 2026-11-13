"use client";

// The MCP section's control: one segmented switch, enlarged, that swaps the setup between the
// two ways the README documents. It changes one word of the heading and the snippet.

import { useState } from "react";

import { CopyButton } from "@/components/chat/Code";

const DESKTOP = `{
  "mcpServers": {
    "quarry": {
      "command": "uv",
      "args": ["run", "--directory", "/absolute/path/to/quarry",
               "python", "-m", "quarry.mcp.server"]
    }
  }
}`;

const ANY = `# from the repository, any MCP client over stdio
make mcp

# which runs
uv run python -m quarry.mcp.server`;

export function McpSwitch() {
  const [mode, setMode] = useState<"desktop" | "any">("desktop");
  const code = mode === "desktop" ? DESKTOP : ANY;
  return (
    <div className="mcp">
      <div className="mcp-text" data-reveal>
        <h2 id="mcp-title">
          Use it from <span className="mcp-word">{mode === "desktop" ? "Claude Desktop" : "any MCP client"}</span>
        </h2>
        <p>
          Quarry runs as an MCP server over stdio: <code>list_tables</code>, <code>describe_table</code>, <code>sample_rows</code>, <code>run_sql</code>,{" "}
          <code>make_chart</code>, <code>run_python</code> and <code>ask_quarry</code>, each with every guardrail it has in the app.
        </p>
      </div>
      <div className="mcp-control" data-ui role="radiogroup" aria-labelledby="mcp-title">
        {(
          [
            ["desktop", "Claude Desktop"],
            ["any", "Any MCP client"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" role="radio" aria-checked={mode === k} onClick={() => setMode(k)}>
            {label}
          </button>
        ))}
      </div>
      <div className="mcp-code" data-ui>
        <p className="mcp-file">{mode === "desktop" ? "claude_desktop_config.json" : "Terminal"}</p>
        <pre>
          <code>{code}</code>
        </pre>
        <CopyButton text={code} label="Copy the setup" />
      </div>
    </div>
  );
}
