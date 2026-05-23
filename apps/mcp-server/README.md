# AdMatix MCP Server

The MCP server exposes the safe AdMatix agent surface over stdio. It registers
exactly six tools:

- `audit_account`
- `create_plan`
- `show_h0_packet`
- `validate_h0_packet`
- `activate_dry_run`
- `run_benchmark`

`activate_dry_run` is write-shaped but still dry-run only. It returns an
`ExecutionDiff` and never mutates an ad platform. Calls without an approved
`approval_receipt` return a `blocked` envelope.

## Client Config

```json
{
  "mcpServers": {
    "admatix": {
      "command": "pnpm",
      "args": ["--filter", "@admatix/mcp-server", "tsx", "src/server.ts"],
      "cwd": "/path/to/admatix",
      "env": {
        "ADMATIX_MODE": "fixtures"
      }
    }
  }
}
```

During the MVP, use fixture account refs such as `fixture:acc_demo`. Live
platform credentials are not required and are not read by this server.
