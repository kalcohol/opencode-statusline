import type { DialogSelectOptions } from "@opencode/plugin/tui/context";
import { STATUSLINE_FIELDS, toggleStatuslineField, type StatuslineFieldID } from "./statusline-config.js";

export function fieldOptions(fields: readonly StatuslineFieldID[]) {
  return STATUSLINE_FIELDS.map((field) => {
    const index = fields.indexOf(field.id);
    return {
      title: `${index >= 0 ? "[x]" : "[ ]"} ${field.label}`,
      value: field.id,
      description: index >= 0 ? `#${index + 1} ${field.id}` : field.id
    };
  });
}

export function createFieldSaveQueue(
  save: (fields: readonly StatuslineFieldID[]) => Promise<unknown>
): (fields: readonly StatuslineFieldID[]) => Promise<unknown> {
  let queue: Promise<unknown> = Promise.resolve();
  return (fields) => {
    queue = queue.then(() => save(fields));
    return queue;
  };
}

export type StatuslineEditorDependencies = {
  fields: () => readonly StatuslineFieldID[];
  persist: (fields: readonly StatuslineFieldID[]) => Promise<unknown>;
  select: (options: DialogSelectOptions<StatuslineFieldID>) => Promise<StatuslineFieldID | undefined>;
  clearDialog: () => void;
};

export async function runStatuslineEditor(dependencies: StatuslineEditorDependencies): Promise<void> {
  let draft = [...dependencies.fields()];
  let current: StatuslineFieldID | undefined = draft[0];
  while (true) {
    const selected = await dependencies.select({
      title: "Statusline fields",
      placeholder: "Search fields",
      options: fieldOptions(draft),
      current,
      actions: [
        {
          bind: "ctrl+g",
          title: "Clear all",
          selection: "none",
          onTrigger: () => {
            draft = [];
            void dependencies.persist(draft);
            dependencies.clearDialog();
          }
        }
      ]
    });
    if (!selected) return;
    current = selected;
    draft = toggleStatuslineField(draft, selected);
    void dependencies.persist(draft);
  }
}
