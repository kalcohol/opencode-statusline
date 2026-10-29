/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import { Show } from "solid-js";
import { Statusline } from "./lib/statusline-view.js";
import { openQuotaDialog } from "./lib/quota-dialog.js";
import {
  DEFAULT_STATUSLINE_FIELDS,
  STATUSLINE_CONFIG_VERSION,
  STATUSLINE_FIELDS,
  normalizeStatuslineFields,
  parseStatuslineFieldArguments,
  toggleStatuslineField,
  type StatuslineFieldID
} from "./lib/statusline-config.js";

type Settings = {
  version: number;
  fields: StatuslineFieldID[];
};

type UpdateSettings = (mutation: (draft: Settings) => void) => Promise<void>;
type FieldsAccessor = () => readonly StatuslineFieldID[];
type PersistFields = (fields: readonly StatuslineFieldID[]) => Promise<unknown>;

function fieldOptions(fields: readonly StatuslineFieldID[]) {
  return STATUSLINE_FIELDS.map((field) => {
    const index = fields.indexOf(field.id);
    return {
      title: `${index >= 0 ? "[x]" : "[ ]"} ${field.label}`,
      value: field.id,
      description: index >= 0 ? `#${index + 1} ${field.id}` : field.id
    };
  });
}

function sameFields(left: readonly StatuslineFieldID[], right: readonly StatuslineFieldID[]): boolean {
  return left.length === right.length && left.every((field, index) => field === right[index]);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

async function saveFields(
  context: Context,
  update: UpdateSettings,
  fields: readonly StatuslineFieldID[]
): Promise<boolean> {
  try {
    await update((draft) => {
      draft.version = STATUSLINE_CONFIG_VERSION;
      draft.fields = [...fields];
    });
    return true;
  } catch (error) {
    context.ui.toast.show({
      variant: "error",
      message: `Failed to save statusline fields: ${errorMessage(error)}`
    });
    return false;
  }
}

async function openStatuslineDialog(
  context: Context,
  persist: PersistFields,
  fields: FieldsAccessor
): Promise<void> {
  let draft = [...fields()];
  let current: StatuslineFieldID | undefined = draft[0];
  while (true) {
    const selected: StatuslineFieldID | undefined = await context.ui.dialog.select<StatuslineFieldID>({
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
            void persist(draft);
            context.ui.dialog.clear();
          }
        }
      ]
    });
    if (!selected) return;
    current = selected;
    draft = toggleStatuslineField(draft, selected);
    void persist(draft);
  }
}

async function configureStatusline(
  context: Context,
  persist: PersistFields,
  fields: FieldsAccessor,
  input: string | undefined
): Promise<void> {
  const raw = input?.trim();
  if (!raw) {
    await openStatuslineDialog(context, persist, fields);
    return;
  }

  const parsed = parseStatuslineFieldArguments(raw);
  if (parsed.clear) {
    if (await persist([])) {
      context.ui.toast.show({ message: "Statusline cleared", variant: "success" });
    }
    return;
  }
  if (!parsed.fields.length) {
    context.ui.toast.show({
      message: `Unknown statusline field: ${parsed.unknown.join(", ")}`,
      variant: "warning"
    });
    return;
  }
  if (!(await persist(parsed.fields))) return;
  if (parsed.unknown.length) {
    context.ui.toast.show({
      message: `Skipped unknown fields: ${parsed.unknown.join(", ")}`,
      variant: "warning"
    });
  }
}

export default Plugin.define({
  id: "opencode-statusline",
  setup(context) {
    const [settings, update] = context.storage.store<Settings>("settings", {
      initial: {
        version: STATUSLINE_CONFIG_VERSION,
        fields: [...DEFAULT_STATUSLINE_FIELDS]
      }
    });
    const fields: FieldsAccessor = () => normalizeStatuslineFields(settings.fields);
    let saveQueue: Promise<unknown> = Promise.resolve();
    const persist: PersistFields = (next) => {
      saveQueue = saveQueue.then(() => saveFields(context, update, next));
      return saveQueue;
    };
    if (
      settings.version !== STATUSLINE_CONFIG_VERSION ||
      !Array.isArray(settings.fields) ||
      !sameFields(fields(), settings.fields)
    ) {
      void persist(fields());
    }

    context.ui.slot({
      append: "prompt.footer.status",
      render: (input) => (
        <Show
          when={input.mode === "normal" && input.showDetails && Boolean(input.sessionID)}
          fallback={null}
        >
          <Statusline
            context={context}
            sessionID={input.sessionID ?? ""}
            fields={fields()}
          />
        </Show>
      )
    });

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "opencode-statusline.configure",
          title: "Statusline fields",
          description: "Choose which fields appear in the prompt footer statusline",
          group: "System",
          palette: true,
          slash: { name: "statusline", arguments: true },
          run: (input) => {
            void configureStatusline(context, persist, fields, input).catch((error) => {
              context.ui.toast.show({
                variant: "error",
                message: `Statusline command failed: ${errorMessage(error)}`
              });
            });
          }
        },
        {
          id: "opencode-statusline.quota",
          title: "Provider quota",
          description: "Show provider quota and balance without adding it to model context",
          group: "System",
          palette: true,
          slash: { name: "quota", arguments: true },
          run: () => {
            openQuotaDialog(context)
          }
        }
      ]
    }));
  }
});
