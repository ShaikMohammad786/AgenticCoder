import { useState, useEffect, useCallback } from "react";
import { TextAttributes } from "@opentui/core";
import { useDialog } from "../../providers/dialog";
import { useToast } from "../../providers/toast";
import { useTheme } from "../../providers/theme";
import { DialogSearchList } from "../dialog-search-list";
import { loadSkills, getBuiltinSkills, type Skill } from "../../lib/skills";

type SkillItem = Skill & { isBuiltin: boolean };

type Props = {
  onSelectSkill: (skill: Skill) => void;
};

export const SkillsDialogContent = ({ onSelectSkill }: Props) => {
  const dialog = useDialog();
  const toast = useToast();
  const { colors } = useTheme();
  const [items, setItems] = useState<SkillItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    (async () => {
      const [userSkills, builtinSkills] = await Promise.all([
        loadSkills(),
        Promise.resolve(getBuiltinSkills()),
      ]);
      if (ignore) return;

      const all: SkillItem[] = [
        ...userSkills.map((s) => ({ ...s, isBuiltin: false })),
        ...builtinSkills.map((s) => ({ ...s, isBuiltin: true })),
      ];
      setItems(all);
      setLoading(false);
    })();
    return () => { ignore = true; };
  }, []);

  const handleSelect = useCallback(
    (item: SkillItem) => {
      dialog.close();
      onSelectSkill(item);
      toast.show({
        variant: "success",
        message: `Skill "${item.name}" activated${item.mode ? ` (${item.mode} mode)` : ""}`,
      });
    },
    [dialog, toast, onSelectSkill],
  );

  if (loading) {
    return (
      <box paddingX={2} paddingY={1}>
        <text attributes={TextAttributes.DIM}>Loading skills...</text>
      </box>
    );
  }

  return (
    <DialogSearchList
      items={items}
      onSelect={handleSelect}
      filterFn={(item, query) =>
        item.name.toLowerCase().includes(query.toLowerCase()) ||
        item.description.toLowerCase().includes(query.toLowerCase())
      }
      renderItem={(item, isSelected) => {
        const badge = item.isBuiltin ? "★" : "◆";
        const modeBadge = item.mode ? ` [${item.mode}]` : "";
        return (
          <text selectable={false} fg={isSelected ? "black" : "white"}>
            {"  " + badge + " " + item.name.padEnd(18) + modeBadge.padEnd(8) + item.description}
          </text>
        );
      }}
      getKey={(item) => item.filePath}
      placeholder="Search skills"
      emptyText="No matching skills"
    />
  );
};
