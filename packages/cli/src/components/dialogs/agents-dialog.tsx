import { useCallback } from "react";
import { TextAttributes } from "@opentui/core";
import { useDialog } from "../../providers/dialog";
import { useTheme } from "../../providers/theme";
import { DialogSearchList } from "../dialog-search-list";
import { Mode, type ModeType } from "@agenticcoder/shared";

const AGENTS: { mode: ModeType; label: string; description: string }[] = [
  { 
    mode: Mode.BUILD, 
    label: "Build", 
    description: "Full read/write access · implement changes directly" 
  },
  { 
    mode: Mode.PLAN, 
    label: "Plan", 
    description: "Read-only analysis · explore, research, plan" 
  },
];

type AgentsDialogContentProps = {
  currentMode: ModeType;
  onSelectMode: (mode: ModeType) => void;
};

export const AgentsDialogContent = ({ 
  currentMode, 
  onSelectMode 
}: AgentsDialogContentProps) => {
  const dialog = useDialog();
  const { colors } = useTheme();

  const handleSelect = useCallback(
    (agent: typeof AGENTS[number]) => {
      onSelectMode(agent.mode);
      dialog.close();
    },
    [onSelectMode, dialog],
  );

  return (
    <DialogSearchList
      items={AGENTS}
      onSelect={handleSelect}
      filterFn={(item, query) => item.label.toLowerCase().includes(query.toLowerCase())}
      renderItem={(item, isSelected) => (
        <text selectable={false} fg={isSelected ? "black" : "white"}>
          {(item.mode === currentMode ? " ◉ " : " ○ ") + item.label + "  " + item.description}
        </text>
      )}
      getKey={(item) => item.mode}
      placeholder="Search agents"
      emptyText="No matching agents"
    />
  );
};