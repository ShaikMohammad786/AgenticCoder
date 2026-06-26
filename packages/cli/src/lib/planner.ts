/**
 * Hierarchical Planner — breaks down complex goals into sequential tasks.
 *
 * Uses the existing /chat/subagent endpoint with a "planner" agent type
 * to generate a structured task plan. No fake endpoints.
 */

import { resolve } from "path";
import { writeFileSync } from "fs";
import { apiClient } from "./api-client";
import { getAuth } from "./auth";

// ─── Types ────────────────────────────────────────────────────────────

export type PlanTask = {
  id: string;
  description: string;
  role: "researcher" | "coder" | "reviewer" | "planner" | "debugger";
};

export type PlannerResult = {
  isComplex: boolean;
  planMarkdown: string;
  tasks: PlanTask[];
};

// ─── Complexity Heuristic ─────────────────────────────────────────────

/**
 * Determines whether a user prompt is complex enough to warrant
 * hierarchical planning, or if it's a simple one-shot task.
 */
function isComplexTask(prompt: string): boolean {
  const wordCount = prompt.split(/\s+/).length;
  if (wordCount < 15) return false;

  const complexitySignals = [
    /\band\b.*\band\b/i,           // Multiple "and" conjunctions
    /multiple|several|many/i,       // Plural scope
    /refactor|migrate|rewrite/i,    // Large-scope operations
    /full[- ]stack|end[- ]to[- ]end/i,
    /across\s+(?:all|multiple)/i,
    /step\s*\d|phase\s*\d/i,       // Explicitly phased
    /database.*(?:and|with).*(?:api|frontend)/i,
    /authentication.*(?:and|with)/i,
    /build\s+(?:a|an|the)\s+\w+\s+(?:app|application|system|platform)/i,
  ];

  const matchCount = complexitySignals.filter(r => r.test(prompt)).length;
  return matchCount >= 1 || wordCount > 50;
}

// ─── Plan Generation ──────────────────────────────────────────────────

const PLANNER_PROMPT = `You are a senior technical architect. Given a user's goal, you must:

1. Decide if this is a complex multi-step task (isComplex: true) or a simple task (isComplex: false).
2. If complex, produce:
   - A detailed markdown implementation plan (planMarkdown)
   - A list of sequential tasks, each with an id, description, and role

Roles available: "researcher", "coder", "reviewer", "planner", "debugger"

Respond ONLY with valid JSON matching this exact schema:
{
  "isComplex": boolean,
  "planMarkdown": "# Implementation Plan\\n...",
  "tasks": [
    { "id": "task-1", "description": "...", "role": "researcher" },
    { "id": "task-2", "description": "...", "role": "coder" }
  ]
}

Rules:
- Tasks must be in correct dependency order (later tasks can depend on earlier ones)
- Each task description must be specific and actionable
- Keep tasks to 3-8 items for most goals
- For simple tasks, set isComplex: false, planMarkdown: "", tasks: []
`;

/**
 * Generates a hierarchical plan by calling the real backend /chat/subagent endpoint.
 */
export async function generatePlan(
  prompt: string,
  modelId: string,
  cwd: string,
): Promise<PlannerResult> {
  // Quick exit for obviously simple tasks
  if (!isComplexTask(prompt)) {
    return { isComplex: false, planMarkdown: "", tasks: [] };
  }

  const auth = getAuth();
  if (!auth) {
    throw new Error("Not authenticated. Run `agenticcoder auth login` first.");
  }

  // Use the real /chat/subagent endpoint with a planner agent
  try {
    const response = await fetch(
      `${process.env.AGENTIC_API_URL || "http://localhost:3000"}/chat/subagent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({
          parentSessionId: "planner-session",
          agentType: "planner",
          task: `Break down this goal into an implementation plan:\n\n${prompt}`,
          context: "Generate a JSON response with isComplex, planMarkdown, and tasks fields.",
          model: modelId,
          mode: "PLAN",
          systemPromptOverride: PLANNER_PROMPT,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(`Planner request failed: ${response.status} ${response.statusText}`);
    }

    // The subagent endpoint returns SSE. We need to collect the full response.
    const text = await collectSSEResponse(response);

    // Parse the JSON from the AI response
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Planner did not return valid JSON");
    }

    const result: PlannerResult = JSON.parse(jsonMatch[0]);

    // Validate the result has the expected shape
    if (typeof result.isComplex !== "boolean") {
      throw new Error("Invalid plan: missing isComplex field");
    }

    if (result.isComplex && !result.tasks?.length) {
      throw new Error("Complex plan has no tasks");
    }

    // Write implementation_plan.md for complex tasks
    if (result.isComplex && result.planMarkdown) {
      const planPath = resolve(cwd, "implementation_plan.md");
      writeFileSync(planPath, result.planMarkdown, "utf-8");
    }

    return result;
  } catch (err) {
    // Fallback: generate a simple plan locally if backend fails
    console.error("[planner] Backend planning failed, generating local plan:", err);
    return generateLocalPlan(prompt, cwd);
  }
}

// ─── SSE Response Collector ───────────────────────────────────────────

async function collectSSEResponse(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        const data = line.slice(6);
        if (data === "[DONE]") continue;
        try {
          const parsed = JSON.parse(data);
          // Extract text content from SSE events
          if (parsed.type === "text" && parsed.content) {
            fullText += parsed.content;
          } else if (parsed.type === "tool-result" && parsed.output) {
            fullText += typeof parsed.output === "string"
              ? parsed.output
              : JSON.stringify(parsed.output);
          }
        } catch {
          // Not JSON, might be raw text
          if (data.trim()) fullText += data;
        }
      }
    }
  }

  return fullText;
}

// ─── Local Fallback Planner ───────────────────────────────────────────

function generateLocalPlan(prompt: string, cwd: string): PlannerResult {
  // Simple heuristic-based task decomposition when the backend is unavailable
  const tasks: PlanTask[] = [
    {
      id: "task-1",
      description: `Research the codebase and understand the current architecture relevant to: ${prompt}`,
      role: "researcher",
    },
    {
      id: "task-2",
      description: `Implement the changes: ${prompt}`,
      role: "coder",
    },
    {
      id: "task-3",
      description: `Review the implementation for bugs and code quality issues`,
      role: "reviewer",
    },
  ];

  const planMarkdown = `# Implementation Plan

## Goal
${prompt}

## Tasks
${tasks.map((t, i) => `${i + 1}. **${t.role}**: ${t.description}`).join("\n")}

## Notes
- This plan was generated locally (backend planner unavailable)
- Tasks will be executed sequentially by specialized subagents
`;

  writeFileSync(resolve(cwd, "implementation_plan.md"), planMarkdown, "utf-8");

  return {
    isComplex: true,
    planMarkdown,
    tasks,
  };
}
