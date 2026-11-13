"use client";

// The MCP section: the setup for the two ways the README documents, switched by tabs on the
// code panel. Switching also changes the last words of the heading.

import { useState } from "react";

import { CopyButton } from "@/components/chat/Code";

const DESKTOP = `{
  "mcpServers": {
    "quarry": {
      "command": "uv",
      "args": [
        "run", "--directory", "/absolute/path/to/quarry",
        "python", "-m", "quarry.mcp.server"
      ]
    }
  }
}`;

const ANY = `# from the repository: an MCP server over stdio
make mcp

# which runs
uv run python -m quarry.mcp.server`;

const MODES = [
  { key: "desktop", label: "Claude Desktop", file: "claude_desktop_config.json", code: DESKTOP },
  { key: "any", label: "Any MCP client", file: "Terminal", code: ANY },
] as const;

export function McpSwitch() {
  const [mode, setMode] = useState<(typeof MODES)[number]["key"]>("desktop");
  const current = MODES.find((m) => m.key === mode)!;
  return (
    <div className="mcp">
      <div className="mcp-text" data-reveal>
        <h2 id="mcp-title">
          Use it from <span className="mcp-word">{mode === "desktop" ? "Claude Desktop" : "any MCP client"}</span>
        </h2>
        <p>
          Quarry runs as an MCP server over stdio. The tools are <code>list_tables</code>, <code>describe_table</code>, <code>sample_rows</code>,{" "}
          <code>run_sql</code>, <code>make_chart</code>, <code>run_python</code> and <code>ask_quarry</code>, each with every guardrail it has in the app.
        </p>
      </div>
      <div className="mcp-panel" data-ui data-reveal>
        <div className="mcp-tabs" role="tablist" aria-label="Where to use Quarry">
          {MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              role="tab"
              id={`mcp-tab-${m.key}`}
              aria-selected={mode === m.key}
              aria-controls="mcp-code"
              onClick={() => setMode(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
        <div className="mcp-code" id="mcp-code" role="tabpanel" aria-labelledby={`mcp-tab-${mode}`}>
          <p className="mcp-file">{current.file}</p>
          <pre>
            <code>{current.code}</code>
          </pre>
          <CopyButton text={current.code} label="Copy the setup" />
        </div>
      </div>
    </div>
  );
}
