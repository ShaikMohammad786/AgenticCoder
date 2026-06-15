import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createMemoryRouter, RouterProvider, useRouteError } from "react-router";
import { RootLayout } from "./layouts/root-layout";
import { Home } from "./screens/home";
import { NewSession } from "./screens/new-session";
import { Session } from "./screens/session";
import { shutdownMcp } from "./lib/mcp-client";

// ── Process cleanup ─────────────────────────────────────────────
// Kill MCP server subprocesses on exit to prevent orphans

function cleanup() {
  try { shutdownMcp(); } catch {}
}

process.on("exit", cleanup);
process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("SIGTERM", () => { cleanup(); process.exit(0); });
process.on("uncaughtException", (err) => {
  console.error("Fatal error:", err.message);
  cleanup();
  process.exit(1);
});

// React Router's default error boundary renders <h2>, <p> etc. which @opentui doesn't support
function ErrorFallback() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : String(error);

  return (
    <box flexDirection="column" padding={2} gap={1}>
      <text fg="red">{"Something went wrong: " + message}</text>
      <text fg="gray">{"Press Ctrl+C to restart"}</text>
    </box>
  );
}

const router = createMemoryRouter([
  {
    path: "/",
    element: <RootLayout />,
    errorElement: <ErrorFallback />,
    children: [
      { index: true, element: <Home />, errorElement: <ErrorFallback /> },
      { path: "sessions/new", element: <NewSession />, errorElement: <ErrorFallback /> },
      { path: "sessions/:id", element: <Session />, errorElement: <ErrorFallback /> },
    ]
  }
]);

function App() {
  return <RouterProvider router={router} />
}

const renderer = await createCliRenderer({
  targetFps: 60,
  exitOnCtrlC: false,
});
createRoot(renderer).render(<App />);