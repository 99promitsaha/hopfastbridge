# MCP setup

Run `npm ci` and `npm run build` in this directory. Set `HOPFAST_API_URL` to the backend origin (default `http://localhost:8080`).

For a stdio client, configure the command `node` with the absolute path to `mcp/dist/index.js` as an argument and that environment variable. For Streamable HTTP, run `npm run start:http` and connect to `http://localhost:3100/mcp`. The HTTP server binds to loopback only and is currently a development service with permissive CORS; restrict access before public hosting.

Use `tools/list` to discover 11 tools, including `compare_swap_routes`, `get_arc_balance`, `prepare_arc_payment` and `get_payment_status`. Payment status requires the private access token returned by preparation. Keep review links private. The server does not sign or broadcast transactions. Open the returned review link for user wallet approval.

See the root README and DEVELOPMENT.md for configuration, known limits and next phases. There is no published npm package or hosted MCP endpoint for this repository yet.
