import { useState, useCallback } from "react";
import { generatePlan, type PlannerResult, type PlanTask } from "../lib/planner";

export type GoalTask = PlanTask & {
  status: "pending" | "running" | "done" | "failed";
};

export type GoalState = {
  active: boolean;
  prompt: string;
  isComplex: boolean;
  planMarkdown: string;
  tasks: GoalTask[];
};

export function useGoalTracker() {
  const [goal, setGoal] = useState<GoalState | null>(null);
  const [isPlanning, setIsPlanning] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);

  const startGoal = useCallback(async (prompt: string, modelId: string) => {
    setIsPlanning(true);
    setPlanError(null);

    try {
      const result = await generatePlan(prompt, modelId, process.cwd());

      if (result.isComplex) {
        setGoal({
          active: true,
          prompt,
          isComplex: true,
          planMarkdown: result.planMarkdown,
          tasks: result.tasks.map(t => ({ ...t, status: "pending" as const })),
        });
      } else {
        // Not complex enough for planning, signal to use normal chat
        setGoal({
          active: false,
          prompt,
          isComplex: false,
          planMarkdown: "",
          tasks: [],
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPlanError(message);
      console.error("[planner] Planning failed:", message);
      // Set non-active goal so the prompt falls through to normal chat
      setGoal({
        active: false,
        prompt,
        isComplex: false,
        planMarkdown: "",
        tasks: [],
      });
    } finally {
      setIsPlanning(false);
    }
  }, []);

  const updateTaskStatus = useCallback((id: string, status: GoalTask["status"]) => {
    setGoal(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        tasks: prev.tasks.map(t => t.id === id ? { ...t, status } : t),
      };
    });
  }, []);

  const abortGoal = useCallback(() => {
    setGoal(null);
    setPlanError(null);
  }, []);

  return {
    goal,
    isPlanning,
    planError,
    startGoal,
    updateTaskStatus,
    abortGoal,
  };
}
