# Project Instructions

This project is AgenticCoder, a Bun/TypeScript terminal coding agent.

Useful local plugins are installed in `.agenticcoder/plugins`:
- `web_search`: search the web. Set `BRAVE_API_KEY` for full Brave Search results; otherwise it uses a limited DuckDuckGo fallback.
- `npm_package`: inspect npm package metadata, latest versions, dependencies, and repository info.
- `github_repo`: inspect public GitHub repositories, releases, and issues. Set `GITHUB_TOKEN` or `GITHUB_PERSONAL_ACCESS_TOKEN` for higher GitHub API limits.
- `http_request`: call public HTTP APIs while blocking local/private network targets.

Useful MCP servers are configured in `.agenticcoder/mcp.json`:
- filesystem
- memory
- sequential-thinking
- context7
- playwright

AgenticCoder should surface local capabilities in prompt context:
- Installed plugins come from `.agenticcoder/plugins/*/plugin.json` and are exposed as `plugin_<name>`.
- MCP servers come from `.agenticcoder/mcp.json` and their discovered tools are exposed as `mcp_<server>_<tool>`.
- Local skills come from `.agenticcoder/skills/*.md` when present.
- `.env` may be scanned for key names only so the model can tell which integrations are configured. Never include secret values in prompts or chat.
