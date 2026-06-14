import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createMemoryRouter, RouterProvider, useRouteError } from "react-router";
import { RootLayout } from "./layouts/root-layout";
import { Home } from "./screens/home";
import { NewSession } from "./screens/new-session";
import { Session } from "./screens/session";

// Custom error element that uses @opentui components instead of HTML
// React Router's default error boundary renders <h2>, <p> etc. which @opentui doesn't support
function ErrorFallback() {
  const error = useRouteError();
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack ?? "" : "";

  return (
    <box flexDirection="column" padding={2} gap={1}>
      <text fg="red">{"ERROR: " + message}</text>
      <text fg="gray">{stack.split("\n").slice(0, 8).join("\n")}</text>
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