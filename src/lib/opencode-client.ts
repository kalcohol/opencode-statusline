import { collectProviderUsage, type ProviderInfoLike, type UsageReport } from "./providers.js";
import { sanitizeDisplayText, toNonEmptyString, isRecord } from "./format.js";

export type MinimalOpencodeClient = {
  config?: {
    get?: (...args: unknown[]) => Promise<unknown>;
    providers?: (...args: unknown[]) => Promise<unknown>;
  };
  session?: {
    get?: (...args: unknown[]) => Promise<unknown>;
    messages?: (...args: unknown[]) => Promise<unknown>;
    prompt?: (...args: unknown[]) => Promise<unknown>;
  };
  app?: {
    log?: (...args: unknown[]) => Promise<unknown>;
  };
};

export type ModelMeta = {
  providerID: string;
  modelID?: string;
};

function unwrapData(value: unknown): unknown {
  return isRecord(value) && "data" in value ? value.data : value;
}

function parseModelString(value: unknown): ModelMeta | undefined {
  const raw = toNonEmptyString(value);
  if (!raw) return undefined;
  const slash = raw.indexOf("/");
  if (slash <= 0) return undefined;
  return { providerID: raw.slice(0, slash), modelID: raw.slice(slash + 1) || undefined };
}

export async function getConfigData(client: MinimalOpencodeClient): Promise<Record<string, unknown>> {
  try {
    const response = await client.config?.get?.();
    const data = unwrapData(response);
    return isRecord(data) ? data : {};
  } catch {
    return {};
  }
}

export async function getConfiguredProviders(client: MinimalOpencodeClient): Promise<ProviderInfoLike[]> {
  try {
    const response = await client.config?.providers?.();
    const data = unwrapData(response);
    if (isRecord(data) && Array.isArray(data.providers)) return data.providers.filter(isRecord) as ProviderInfoLike[];
    if (Array.isArray(data)) return data.filter(isRecord) as ProviderInfoLike[];
  } catch {
    // Ignore provider-list failures; config/auth fallback still works.
  }
  return [];
}

async function getSessionData(client: MinimalOpencodeClient, sessionID: string): Promise<Record<string, unknown>> {
  const attempts: unknown[][] = [
    [{ path: { id: sessionID } }],
    [{ path: { sessionID } }],
    [{ sessionID }]
  ];
  for (const args of attempts) {
    try {
      const response = await client.session?.get?.(...args);
      const data = unwrapData(response);
      if (isRecord(data)) return data;
    } catch {
      // Try the next SDK shape.
    }
  }
  return {};
}

async function getSessionMessages(client: MinimalOpencodeClient, sessionID: string): Promise<Record<string, unknown>[]> {
  const attempts: unknown[][] = [
    [{ path: { id: sessionID } }],
    [{ path: { sessionID } }],
    [{ sessionID }]
  ];
  for (const args of attempts) {
    try {
      const response = await client.session?.messages?.(...args);
      const data = unwrapData(response);
      if (Array.isArray(data)) return data.filter(isRecord);
      if (isRecord(data) && Array.isArray(data.messages)) return data.messages.filter(isRecord);
    } catch {
      // Try the next SDK shape.
    }
  }
  return [];
}

function modelFromMessage(message: Record<string, unknown>): ModelMeta | undefined {
  const directProvider = toNonEmptyString(message.providerID);
  const directModel = toNonEmptyString(message.modelID);
  if (directProvider) return { providerID: directProvider, modelID: directModel };
  const model = isRecord(message.model) ? message.model : undefined;
  const providerID = toNonEmptyString(model?.providerID);
  const modelID = toNonEmptyString(model?.modelID) ?? toNonEmptyString(model?.id);
  return providerID ? { providerID, modelID } : undefined;
}

export async function resolveActiveModel(input: {
  client: MinimalOpencodeClient;
  sessionID: string;
  config?: Record<string, unknown>;
  commandModel?: unknown;
}): Promise<ModelMeta | undefined> {
  const commandModel = parseModelString(input.commandModel);
  if (commandModel) return commandModel;

  const session = await getSessionData(input.client, input.sessionID);
  const sessionModel = modelFromMessage(session);
  if (sessionModel) return sessionModel;

  const messages = await getSessionMessages(input.client, input.sessionID);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const meta = modelFromMessage(messages[index]);
    if (meta) return meta;
  }

  return parseModelString(input.config?.model);
}

export async function injectIgnoredText(
  client: MinimalOpencodeClient,
  sessionID: string,
  text: string
): Promise<void> {
  const parts = [{ type: "text", text: sanitizeDisplayText(text), ignored: true }];
  try {
    await client.session?.prompt?.({
      path: { id: sessionID },
      body: {
        noReply: true,
        parts
      }
    });
    return;
  } catch (err) {
    try {
      await client.session?.prompt?.({
        sessionID,
        noReply: true,
        parts
      });
      return;
    } catch {
      throw err;
    }
  }
}

export async function buildCurrentProviderUsageReport(input: {
  client: MinimalOpencodeClient;
  sessionID: string;
  force?: boolean;
  commandModel?: unknown;
}): Promise<{ report?: UsageReport; model?: ModelMeta; config: Record<string, unknown> }> {
  const config = await getConfigData(input.client);
  const model = await resolveActiveModel({
    client: input.client,
    sessionID: input.sessionID,
    config,
    commandModel: input.commandModel
  });
  if (!model) return { config };

  const providers = await getConfiguredProviders(input.client);
  const providerInfo = providers.find((provider) => provider.id === model.providerID);
  const report = await collectProviderUsage({
    providerID: model.providerID,
    providerName: toNonEmptyString(providerInfo?.name),
    modelID: model.modelID,
    config,
    providerInfo,
    force: input.force
  });
  return { report, model, config };
}

