import { useTheme } from "../../providers/theme";
import type { GoalState } from "../../hooks/use-goal-tracker";

export function GoalTracker({
  goal,
  isPlanning,
  planError,
}: {
  goal: GoalState | null;
  isPlanning: boolean;
  planError?: string | null;
}) {
  const { colors, borders } = useTheme();

  if (isPlanning) {
    return (
      <box
        borderStyle={borders.style}
        borderColor="blue"
        flexDirection="column"
        paddingX={1}
        width="100%"
        marginBottom={1}
      >
        <text fg="blue">[Planning] Analyzing complexity and breaking down tasks...</text>
      </box>
    );
  }

  if (planError) {
    return (
      <box
        borderStyle={borders.style}
        borderColor="red"
        flexDirection="column"
        paddingX={1}
        width="100%"
        marginBottom={1}
      >
        <text fg="red">[Plan Error] {planError}</text>
        <text dimColor>Falling back to direct chat.</text>
      </box>
    );
  }

  if (!goal || !goal.active) return null;

  const completedCount = goal.tasks.filter(t => t.status === "done").length;
  const totalCount = goal.tasks.length;

  return (
    <box
      borderStyle={borders.style}
      borderColor="green"
      flexDirection="column"
      paddingX={1}
      width="100%"
      marginBottom={1}
    >
      <text bold fg="green">Goal: {goal.prompt}</text>
      <text dimColor>Progress: {completedCount}/{totalCount} tasks</text>

      {goal.planMarkdown && (
        <box marginTop={1} marginBottom={1} flexDirection="column">
          <text bold fg="magenta">Implementation Plan:</text>
          <text dimColor>
            {goal.planMarkdown.length > 300
              ? goal.planMarkdown.slice(0, 300) + "..."
              : goal.planMarkdown}
          </text>
          <text dimColor italic>(Full plan written to implementation_plan.md)</text>
        </box>
      )}

      <box flexDirection="column" marginTop={1}>
        <text bold>Task Checklist:</text>
        {goal.tasks.map((task, idx) => {
          let icon = "[ ]";
          let color = "gray";
          if (task.status === "running") { icon = "[~]"; color = "yellow"; }
          if (task.status === "done") { icon = "[x]"; color = "green"; }
          if (task.status === "failed") { icon = "[!]"; color = "red"; }

          return (
            <text key={task.id} fg={color}>
              {icon} {idx + 1}. {task.description} [{task.role}]
            </text>
          );
        })}
      </box>
    </box>
  );
}
