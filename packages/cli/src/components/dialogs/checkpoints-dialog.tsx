import { useState, useEffect, useCallback } from "react";
import { TextAttributes } from "@opentui/core";
import { useDialog } from "../../providers/dialog";
import { useToast } from "../../providers/toast";
import { useTheme } from "../../providers/theme";
import { DialogSearchList } from "../dialog-search-list";
import { listCheckpoints, createCheckpoint, restoreCheckpoint } from "../../lib/checkpoint";

type CheckpointItem = {
  index: number;
  id: string;
  timeAgo: string;
  stashRef: string;
  label: string;
};

export const CheckpointsDialogContent = () => {
  const dialog = useDialog();
  const toast = useToast();
  const { colors } = useTheme();
  const [items, setItems] = useState<CheckpointItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmIndex, setConfirmIndex] = useState<number | null>(null);

  // Load checkpoints on mount
  useEffect(() => {
    let ignore = false;
    (async () => {
      const { checkpoints, message } = await listCheckpoints();
      if (ignore) return;
      if (message) {
        toast.show({ variant: "error", message });
        dialog.close();
        return;
      }

      const mapped: CheckpointItem[] = checkpoints.map((cp) => ({
        ...cp,
        label: `Checkpoint #${cp.index}`,
      }));

      // Add "Create new" as the first item
      mapped.unshift({
        index: -1,
        id: "__create__",
        timeAgo: "",
        stashRef: "",
        label: "+ Create new checkpoint",
      });

      setItems(mapped);
      setLoading(false);
    })();
    return () => { ignore = true; };
  }, []);

  const handleSelect = useCallback(
    async (item: CheckpointItem) => {
      // Create new checkpoint
      if (item.id === "__create__") {
        dialog.close();
        toast.show({ message: "Creating checkpoint..." });
        try {
          const id = await createCheckpoint();
          toast.show({
            variant: id ? "success" : undefined,
            message: id ? "Checkpoint created \u2713" : "No changes to checkpoint",
          });
        } catch (err) {
          toast.show({
            variant: "error",
            message: err instanceof Error ? err.message : "Checkpoint failed",
          });
        }
        return;
      }

      // Two-step confirmation for restore
      if (confirmIndex !== item.index) {
        // First select — ask for confirmation
        setConfirmIndex(item.index);
        return;
      }

      // Second select — actually restore
      dialog.close();
      toast.show({ message: `Restoring checkpoint #${item.index}...` });
      try {
        const result = await restoreCheckpoint(item.index);
        toast.show({
          variant: result.success ? "success" : "error",
          message: result.message,
        });
      } catch (err) {
        toast.show({
          variant: "error",
          message: err instanceof Error ? err.message : "Restore failed",
        });
      }
    },
    [dialog, toast, confirmIndex],
  );

  if (loading) {
    return (
      <box paddingX={2} paddingY={1}>
        <text attributes={TextAttributes.DIM}>Loading checkpoints...</text>
      </box>
    );
  }

  if (items.length <= 1) {
    return (
      <DialogSearchList
        items={items}
        onSelect={handleSelect}
        filterFn={() => true}
        renderItem={(item, isSelected) => (
          <text selectable={false} fg={isSelected ? "black" : colors.primary}>
            {"  " + item.label}
          </text>
        )}
        getKey={(item) => item.id}
        placeholder="No checkpoints yet"
        emptyText="No checkpoints found"
      />
    );
  }

  return (
    <DialogSearchList
      items={items}
      onSelect={handleSelect}
      filterFn={(item, query) =>
        item.label.toLowerCase().includes(query.toLowerCase()) ||
        item.timeAgo.toLowerCase().includes(query.toLowerCase())
      }
      renderItem={(item, isSelected) => {
        if (item.id === "__create__") {
          return (
            <text selectable={false} fg={isSelected ? "black" : colors.primary}>
              {"  " + item.label}
            </text>
          );
        }
        const isConfirming = confirmIndex === item.index;
        return (
          <text selectable={false} fg={isSelected ? "black" : isConfirming ? "yellow" : "white"}>
            {"  #" + item.index + "  " + item.timeAgo + (isConfirming ? "  \u26a0 Press Enter again to restore" : "")}
          </text>
        );
      }}
      getKey={(item) => item.id}
      placeholder="Search checkpoints"
      emptyText="No matching checkpoints"
    />
  );
};
