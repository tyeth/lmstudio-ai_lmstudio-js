import {
  Chat,
  LMStudioClient,
  type ChatMessageInput,
  type LLMInfo,
  type LLMInstanceInfo,
  type LLMPredictionConfigInput,
} from "@lmstudio/sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import "./App.css";

type ConnectionState = "disconnected" | "connecting" | "connected" | "error";

type ConnectionSettings = {
  wsUrl: string;
  httpUrl: string;
  apiToken: string;
  remember: boolean;
};

type RestModel = {
  id: string;
  object?: string;
  owned_by?: string;
};

type GenerationKnobs = {
  temperature: string;
  topP: string;
  topK: string;
  repeatPenalty: string;
  presencePenalty: string;
  maxTokens: string;
  contextOverflowPolicy: "rollingWindow" | "truncateMiddle" | "stopAtLimit";
  stopStrings: string;
  draftModel: string;
  reasoningEnabled: boolean;
  reasoningStart: string;
  reasoningEnd: string;
  userMaxImageDimensionPixels: string;
  ignoreModelPreferredMaxImageDimension: boolean;
};

const DEFAULT_WS = "ws://127.0.0.1:1234";
const SETTINGS_KEY = "lmstudio-gh-pages-settings";

function deriveHttpUrl(wsUrl: string) {
  if (!wsUrl) return "";
  try {
    const url = new URL(wsUrl);
    url.protocol = url.protocol === "wss:" ? "https:" : "http:";
    return url.toString();
  } catch {
    return wsUrl;
  }
}

function formatBytes(bytes: number) {
  if (Number.isNaN(bytes)) return "n/a";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function safeNumber(input: string) {
  const trimmed = input.trim();
  if (trimmed === "") return undefined;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : undefined;
}

const asyncDisposeSymbol: symbol | undefined = (Symbol as any).asyncDispose;

async function disposeClient(target: LMStudioClient | null) {
  if (!target || !asyncDisposeSymbol) return;
  const disposer = (target as any)[asyncDisposeSymbol];
  if (typeof disposer === "function") {
    await disposer.call(target);
  }
}

function usePersistentSettings(): [ConnectionSettings, (next: ConnectionSettings) => void] {
  const [settings, setSettings] = useState<ConnectionSettings>(() => {
    if (typeof window === "undefined") {
      return { wsUrl: DEFAULT_WS, httpUrl: deriveHttpUrl(DEFAULT_WS), apiToken: "", remember: true };
    }
    const saved = window.localStorage.getItem(SETTINGS_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved) as ConnectionSettings;
        return {
          wsUrl: parsed.wsUrl ?? DEFAULT_WS,
          httpUrl: parsed.httpUrl ?? deriveHttpUrl(DEFAULT_WS),
          apiToken: parsed.apiToken ?? "",
          remember: parsed.remember ?? true,
        };
      } catch {
        // ignore
      }
    }
    return { wsUrl: DEFAULT_WS, httpUrl: deriveHttpUrl(DEFAULT_WS), apiToken: "", remember: true };
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (settings.remember) {
      window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } else {
      window.localStorage.removeItem(SETTINGS_KEY);
    }
  }, [settings]);

  return [settings, setSettings];
}

function ModelPill({ model }: { model: LLMInfo }) {
  return (
    <div className="model-pill">
      <div className="model-title">
        <span className="pill-dot" />
        <strong>{model.displayName}</strong>
      </div>
      <div className="model-meta">
        <span>{model.modelKey}</span>
        <span>{model.format}</span>
        <span>{formatBytes(model.sizeBytes)}</span>
        {model.vision ? <span className="chip">vision</span> : null}
        {model.trainedForToolUse ? <span className="chip subtle">tool-use</span> : null}
      </div>
    </div>
  );
}

export default function App() {
  const [settings, setSettings] = usePersistentSettings();
  const [connectionState, setConnectionState] = useState<ConnectionState>("disconnected");
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [client, setClient] = useState<LMStudioClient | null>(null);

  const [downloadedModels, setDownloadedModels] = useState<LLMInfo[]>([]);
  const [loadedModels, setLoadedModels] = useState<LLMInstanceInfo[]>([]);
  const [restModels, setRestModels] = useState<RestModel[]>([]);
  const [restError, setRestError] = useState<string | null>(null);

  const [loadModelKey, setLoadModelKey] = useState("");
  const [loadIdentifier, setLoadIdentifier] = useState("");
  const [loadDevice, setLoadDevice] = useState("");
  const [loadTtlSeconds, setLoadTtlSeconds] = useState("");
  const [loadingModel, setLoadingModel] = useState(false);
  const [autoLoadMissing, setAutoLoadMissing] = useState(true);

  const [activeModelKey, setActiveModelKey] = useState("");

  const [chatHistory, setChatHistory] = useState<(ChatMessageInput & { _reasoning?: string })[]>([]);
  const [userMessage, setUserMessage] = useState("");
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const [streamingReply, setStreamingReply] = useState<{ content: string; reasoning: string }>({
    content: "",
    reasoning: "",
  });
  const [streamError, setStreamError] = useState<string | null>(null);
  const [predictionStats, setPredictionStats] = useState<{ tokens: number; stopReason?: string } | null>(null);
  const [isSending, setIsSending] = useState(false);
  const activePrediction = useRef<any>(null);

  const [advancedConfigText, setAdvancedConfigText] = useState('{\n  "toolChoice": {"type": "generic", "mode": "auto"}\n}');
  const [advancedConfigError, setAdvancedConfigError] = useState<string | null>(null);

  const [knobs, setKnobs] = useState<GenerationKnobs>({
    temperature: "0.7",
    topP: "0.9",
    topK: "40",
    repeatPenalty: "1.1",
    presencePenalty: "0.3",
    maxTokens: "256000",
    contextOverflowPolicy: "rollingWindow",
    stopStrings: "",
    draftModel: "",
    reasoningEnabled: true,
    reasoningStart: "<think>",
    reasoningEnd: "</think>",
    userMaxImageDimensionPixels: "1536",
    ignoreModelPreferredMaxImageDimension: false,
  });

  useEffect(() => {
    if (!settings.httpUrl.trim() && settings.wsUrl.trim()) {
      setSettings({ ...settings, httpUrl: deriveHttpUrl(settings.wsUrl) });
    }
  }, [settings.wsUrl]);

  useEffect(() => {
    return () => {
      void disposeClient(client);
    };
  }, [client]);

  const isConnected = connectionState === "connected";
  const httpBase = useMemo(
    () => (settings.httpUrl.trim() ? settings.httpUrl.trim() : deriveHttpUrl(settings.wsUrl)),
    [settings.httpUrl, settings.wsUrl],
  );

  const normalizeError = (error: unknown) => {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    try {
      return JSON.stringify(error);
    } catch {
      return "Unknown error";
    }
  };

  const connect = async () => {
    setConnectionState("connecting");
    setConnectionError(null);
    setServerVersion(null);
    setDownloadedModels([]);
    setLoadedModels([]);
    setRestModels([]);

    try {
      await disposeClient(client);
      const nextClient = new LMStudioClient({
        baseUrl: settings.wsUrl.trim() || undefined,
        apiToken: settings.apiToken.trim() || undefined,
        verboseErrorMessages: true,
      });
      setClient(nextClient);
      const version = await nextClient.system.getLMStudioVersion();
      setServerVersion(`${version.version} (build ${version.build})`);
      setConnectionState("connected");
      await refreshInventory(nextClient);
    } catch (error) {
      setConnectionState("error");
      setConnectionError(normalizeError(error));
      setClient(null);
    }
  };

  const disconnect = async () => {
    await disposeClient(client);
    setClient(null);
    setConnectionState("disconnected");
    setServerVersion(null);
  };

  const refreshInventory = async (targetClient = client) => {
    if (!targetClient) return;
    try {
      const [downloaded, loaded] = await Promise.all([
        targetClient.system.listDownloadedModels("llm") as Promise<LLMInfo[]>,
        targetClient.llm.listLoaded(),
      ]);
      const loadedInfo = await Promise.all(
        loaded.map(async (model: { getModelInfo: () => Promise<LLMInstanceInfo> }) => {
          try {
            return await model.getModelInfo();
          } catch (error) {
            console.warn("Failed to resolve model info", error);
            return null;
          }
        }),
      );
      setDownloadedModels(downloaded);
      setLoadedModels(loadedInfo.filter(Boolean) as LLMInstanceInfo[]);
      if (!activeModelKey && loadedInfo.length > 0) {
        const candidate = loadedInfo[0];
        if (candidate) {
          setActiveModelKey(candidate.identifier);
        }
      }
    } catch (error) {
      setConnectionError(normalizeError(error));
    }
  };

  const refreshRestModels = async () => {
    if (!httpBase) {
      setRestError("HTTP base URL is empty. Add one or connect with a ws:// URL.");
      return;
    }
    setRestError(null);
    try {
      const response = await fetch(`${httpBase.replace(/\/$/, "")}/v1/models`, {
        headers: settings.apiToken.trim() ? { Authorization: `Bearer ${settings.apiToken.trim()}` } : undefined,
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} while hitting ${response.url}`);
      }
      const data = (await response.json()) as { data?: RestModel[] };
      setRestModels(data.data ?? []);
    } catch (error) {
      setRestError(normalizeError(error));
    }
  };

  const loadModel = async () => {
    if (!client) {
      setConnectionError("Connect to LM Studio first.");
      return;
    }
    if (!loadModelKey.trim()) {
      setConnectionError("Enter a model key to load.");
      return;
    }
    setLoadingModel(true);
    setConnectionError(null);
    try {
      const model = await client.llm.load(loadModelKey.trim(), {
        identifier: loadIdentifier.trim() || undefined,
        deviceIdentifier: loadDevice.trim() || undefined,
        ttl: safeNumber(loadTtlSeconds),
        verbose: true,
      });
      const info = await model.getModelInfo();
      setActiveModelKey(info.identifier);
      await refreshInventory(client);
    } catch (error) {
      setConnectionError(normalizeError(error));
    } finally {
      setLoadingModel(false);
    }
  };

  const ensureModelLoaded = async (modelKey: string) => {
    if (!client) throw new Error("Connect to LM Studio first.");
    const alreadyLoaded = loadedModels.find(
      model => model.identifier === modelKey || model.modelKey === modelKey || model.displayName === modelKey,
    );
    if (alreadyLoaded) {
      return client.llm.createDynamicHandle({ identifier: alreadyLoaded.identifier });
    }
    if (!autoLoadMissing) {
      return client.llm.createDynamicHandle({ path: modelKey });
    }
    const model = await client.llm.load(modelKey, { identifier: modelKey, verbose: false });
    const info = await model.getModelInfo();
    await refreshInventory(client);
    return client.llm.createDynamicHandle({ identifier: info.identifier });
  };

  const readFileAsBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result?.toString() ?? "";
        const clean = result.includes(",") ? result.split(",").pop() ?? "" : result;
        resolve(clean);
      };
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });

  const buildPredictionConfig = (): LLMPredictionConfigInput => {
    const config: LLMPredictionConfigInput = {};
    const temperature = safeNumber(knobs.temperature);
    const topP = safeNumber(knobs.topP);
    const topK = safeNumber(knobs.topK);
    const repeatPenalty = safeNumber(knobs.repeatPenalty);
    const presencePenalty = safeNumber(knobs.presencePenalty);
    const maxTokens = safeNumber(knobs.maxTokens);
    const userMaxImageDimensionPixels = safeNumber(knobs.userMaxImageDimensionPixels);

    if (temperature !== undefined) config.temperature = temperature;
    if (topP !== undefined) config.topPSampling = topP;
    if (topK !== undefined) config.topKSampling = topK;
    if (repeatPenalty !== undefined) config.repeatPenalty = repeatPenalty;
    if (presencePenalty !== undefined) config.presencePenalty = presencePenalty;
    if (maxTokens !== undefined) config.maxTokens = maxTokens;
    if (userMaxImageDimensionPixels !== undefined) config.userMaxImageDimensionPixels = userMaxImageDimensionPixels;
    if (knobs.ignoreModelPreferredMaxImageDimension) {
      config.ignoreModelPreferredMaxImageDimension = true;
    }
    if (knobs.draftModel.trim()) config.draftModel = knobs.draftModel.trim();
    config.contextOverflowPolicy = knobs.contextOverflowPolicy;
    if (knobs.stopStrings.trim()) {
      const parts = knobs.stopStrings
        .split(",")
        .map(part => part.trim())
        .filter(Boolean);
      if (parts.length > 0) {
        config.stopStrings = parts;
      }
    }
    if (knobs.reasoningEnabled) {
      config.reasoningParsing = {
        enabled: true,
        startString: knobs.reasoningStart || "<think>",
        endString: knobs.reasoningEnd || "</think>",
      };
    }

    if (advancedConfigText.trim()) {
      try {
        const parsed = JSON.parse(advancedConfigText);
        Object.assign(config, parsed);
        setAdvancedConfigError(null);
      } catch (error) {
        setAdvancedConfigError(normalizeError(error));
      }
    }

    return config;
  };

  const sendMessage = async () => {
    if (!client) {
      setStreamError("Connect to LM Studio first.");
      return;
    }
    if (!activeModelKey.trim()) {
      setStreamError("Choose or load a model first.");
      return;
    }
    if (!userMessage.trim() && attachedFiles.length === 0) {
      setStreamError("Add a message or an image to send.");
      return;
    }
    setIsSending(true);
    setStreamError(null);
    setPredictionStats(null);
    setStreamingReply({ content: "", reasoning: "" });

    try {
      const handles =
        attachedFiles.length === 0
          ? []
          : await Promise.all(
              attachedFiles.map(async file => {
                const base64 = await readFileAsBase64(file);
                return await client.files.prepareImageBase64(file.name, base64);
              }),
            );

      const pureHistory: ChatMessageInput[] = chatHistory.map(m => ({
        role: m.role,
        content: m.content,
        images: m.images,
      }));
      const updatedHistory: ChatMessageInput[] = [
        ...pureHistory,
        { role: "user", content: userMessage, images: handles },
      ];
      const chat = Chat.from(updatedHistory);
      const model = await ensureModelLoaded(activeModelKey);
      const prediction = model.respond(chat, buildPredictionConfig());
      activePrediction.current = prediction;

      let assembled = "";
      let reasoning = "";
      for await (const fragment of prediction) {
        if (fragment.reasoningType === "reasoning") {
          reasoning += fragment.content;
        } else {
          assembled += fragment.content;
        }
        setStreamingReply({ content: assembled, reasoning });
      }
      const result = await prediction;
      setPredictionStats({
        tokens: result.stats.predictedTokensCount ?? result.stats.totalTokensCount ?? 0,
        stopReason: result.stats.stopReason,
      });
      setChatHistory([
        ...chatHistory,
        { role: "user", content: userMessage, images: handles },
        {
          role: "assistant",
          content: knobs.reasoningEnabled ? result.nonReasoningContent : result.content,
          _reasoning: knobs.reasoningEnabled ? result.reasoningContent : undefined,
        },
      ]);
      setStreamingReply({ content: "", reasoning: "" });
      setUserMessage("");
      setAttachedFiles([]);
    } catch (error) {
      setStreamError(normalizeError(error));
    } finally {
      setIsSending(false);
      activePrediction.current = null;
    }
  };

  const cancelPrediction = async () => {
    if (activePrediction.current) {
      await activePrediction.current.cancel();
      activePrediction.current = null;
      setIsSending(false);
    }
  };

  const renderedHistory = [...chatHistory];
  if (streamingReply.content || streamingReply.reasoning) {
    renderedHistory.push({
      role: "assistant",
      content: streamingReply.content,
      _reasoning: streamingReply.reasoning,
    });
  }

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">LM Studio · Playground</p>
          <h1>
            Ship a GitHub Pages demo that speaks to any LM Studio server — text, tools, and vision in one place.
          </h1>
          <p className="lede">
            Point to a local or remote LM Studio instance, browse models via REST, and chat with them using the
            TypeScript SDK. Optional tokens, thinking-aware streaming, image uploads, and a handful of useful knobs
            included.
          </p>
          <div className="hero-actions">
            <button className="button primary" onClick={connect} disabled={connectionState === "connecting"}>
              {connectionState === "connecting" ? "Connecting…" : isConnected ? "Reconnect" : "Connect"}
            </button>
            <button className="button ghost" onClick={disconnect} disabled={!client}>
              Disconnect
            </button>
            {serverVersion ? <span className="chip">Server {serverVersion}</span> : null}
          </div>
          <p className="hint">
            Tip: start your server with CORS enabled for GitHub Pages access:{" "}
            <code>lms server start --cors --api-token &lt;token&gt;</code>
          </p>
        </div>
      </header>

      <section className="grid">
        <details className="card" open>
          <summary className="card-header">
            <div>
              <p className="eyebrow">Connection</p>
              <h3>Target LM Studio server</h3>
            </div>
            <span className={`status ${connectionState}`}>{connectionState}</span>
          </summary>

          <div className="form-grid">
            <label>
              WebSocket base URL
              <input
                value={settings.wsUrl}
                onChange={e => setSettings({ ...settings, wsUrl: e.target.value })}
                placeholder={DEFAULT_WS}
              />
            </label>
            <label>
              HTTP base (for REST browse)
              <input
                value={settings.httpUrl}
                onChange={e => setSettings({ ...settings, httpUrl: e.target.value })}
                placeholder={deriveHttpUrl(DEFAULT_WS)}
              />
            </label>
            <label>
              API token (optional)
              <input
                value={settings.apiToken}
                onChange={e => setSettings({ ...settings, apiToken: e.target.value })}
                placeholder="sk-lm-…"
              />
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={settings.remember}
                onChange={e => setSettings({ ...settings, remember: e.target.checked })}
              />
              Remember settings locally
            </label>
          </div>
          {connectionError ? <div className="callout error">{connectionError}</div> : null}
        </details>

        <details className="card" open>
          <summary className="card-header">
            <div>
              <p className="eyebrow">Models</p>
              <h3>Downloaded + loaded</h3>
            </div>
            <div className="card-actions">
              <button className="button ghost" onClick={() => refreshInventory()} disabled={!isConnected}>
                Refresh
              </button>
            </div>
          </summary>

          <div className="mini-grid">
            <div className="stack">
              <h4>Downloaded (REST-over-WS)</h4>
              <div className="pill-stack">
                {downloadedModels.length === 0 ? <p className="muted">No models discovered yet.</p> : null}
                {downloadedModels.map(model => (
                  <button
                    key={model.modelKey}
                    className={`pill-button ${activeModelKey === model.modelKey ? "selected" : ""}`}
                    onClick={() => setActiveModelKey(model.modelKey)}
                  >
                    <ModelPill model={model} />
                  </button>
                ))}
              </div>
            </div>
            <div className="stack">
              <h4>Loaded instances</h4>
              <div className="pill-stack">
                {loadedModels.length === 0 ? <p className="muted">Nothing loaded.</p> : null}
                {loadedModels.map(model => (
                  <button
                    key={model.identifier}
                    className={`pill-button ${activeModelKey === model.identifier ? "selected" : ""}`}
                    onClick={() => setActiveModelKey(model.identifier)}
                  >
                    <div className="model-pill">
                      <div className="model-title">
                        <span className="pill-dot" />
                        <strong>{model.displayName}</strong>
                      </div>
                      <div className="model-meta">
                        <span>{model.identifier}</span>
                        <span>ctx: {model.contextLength}</span>
                        <span>{formatBytes(model.sizeBytes)}</span>
                        {model.vision ? <span className="chip">vision</span> : null}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="divider" />

          <div className="form-grid">
            <label>
              Model key or identifier
              <input value={loadModelKey} onChange={e => setLoadModelKey(e.target.value)} placeholder="llama-3.2-3b-instruct" />
            </label>
            <label>
              Identifier (optional)
              <input value={loadIdentifier} onChange={e => setLoadIdentifier(e.target.value)} placeholder="my-session-model" />
            </label>
            <label>
              Device (optional)
              <input value={loadDevice} onChange={e => setLoadDevice(e.target.value)} placeholder="device id or blank" />
            </label>
            <label>
              TTL seconds (optional)
              <input value={loadTtlSeconds} onChange={e => setLoadTtlSeconds(e.target.value)} placeholder="e.g. 600" />
            </label>
          </div>
          <div className="card-actions">
            <label className="checkbox-row">
              <input type="checkbox" checked={autoLoadMissing} onChange={e => setAutoLoadMissing(e.target.checked)} />
              Auto-load if not already loaded
            </label>
            <button className="button primary" onClick={loadModel} disabled={!isConnected || loadingModel}>
              {loadingModel ? "Loading…" : "Load model"}
            </button>
          </div>
        </details>

        <details className="card rest-card">
          <summary className="card-header">
            <div>
              <p className="eyebrow">REST browse</p>
              <h3>/v1/models</h3>
            </div>
            <div className="card-actions">
              <button className="button ghost" onClick={refreshRestModels} disabled={!httpBase}>
                Pull list
              </button>
            </div>
          </summary>
          {restError ? <div className="callout error">{restError}</div> : null}
          <div className="rest-list">
            {restModels.length === 0 ? <p className="muted">No REST models yet. Hit “Pull list”.</p> : null}
            {restModels.map(model => (
              <div key={model.id} className="rest-row">
                <div>
                  <strong>{model.id}</strong>
                  <p className="muted">{model.object ?? "model"} {model.owned_by ? `· ${model.owned_by}` : ""}</p>
                </div>
                <button className="button ghost" onClick={() => setActiveModelKey(model.id)}>
                  Use for chat
                </button>
              </div>
            ))}
          </div>
        </details>
      </section>

      <section className="playground">
        <details className="card" open>
          <summary className="card-header">
            <div>
              <p className="eyebrow">Playground</p>
              <h3>Chat, vision, and streaming</h3>
            </div>
            <div className="card-actions">
              <span className="chip subtle">Active model: {activeModelKey || "none"}</span>
              <button className="button ghost" onClick={cancelPrediction} disabled={!isSending}>
                Stop
              </button>
              <button className="button primary" onClick={sendMessage} disabled={isSending || !isConnected}>
                {isSending ? "Streaming…" : "Send"}
              </button>
            </div>
          </summary>

          <div className="playground-grid">
          <details className="stack">
            <summary><h4>Generation knobs</h4></summary>
            <div className="form-grid slim">
              <label>
                Temperature
                <input value={knobs.temperature} onChange={e => setKnobs({ ...knobs, temperature: e.target.value })} />
              </label>
              <label>
                Top P
                <input value={knobs.topP} onChange={e => setKnobs({ ...knobs, topP: e.target.value })} />
              </label>
              <label>
                Top K
                <input value={knobs.topK} onChange={e => setKnobs({ ...knobs, topK: e.target.value })} />
              </label>
              <label>
                Repeat penalty
                <input value={knobs.repeatPenalty} onChange={e => setKnobs({ ...knobs, repeatPenalty: e.target.value })} />
              </label>
              <label>
                Presence penalty
                <input
                  value={knobs.presencePenalty}
                  onChange={e => setKnobs({ ...knobs, presencePenalty: e.target.value })}
                />
              </label>
              <label>
                Max tokens
                <input value={knobs.maxTokens} onChange={e => setKnobs({ ...knobs, maxTokens: e.target.value })} />
              </label>
              <label>
                Context overflow
                <select
                  value={knobs.contextOverflowPolicy}
                  onChange={e =>
                    setKnobs({
                      ...knobs,
                      contextOverflowPolicy: e.target.value as GenerationKnobs["contextOverflowPolicy"],
                    })
                  }
                >
                  <option value="rollingWindow">rollingWindow</option>
                  <option value="truncateMiddle">truncateMiddle</option>
                  <option value="stopAtLimit">stopAtLimit</option>
                </select>
              </label>
              <label>
                Draft model (for speculative decoding)
                <input value={knobs.draftModel} onChange={e => setKnobs({ ...knobs, draftModel: e.target.value })} />
              </label>
              <label>
                Stop strings (comma separated)
                <input value={knobs.stopStrings} onChange={e => setKnobs({ ...knobs, stopStrings: e.target.value })} />
              </label>
              <label>
                Max image dimension (px)
                <input
                  value={knobs.userMaxImageDimensionPixels}
                  onChange={e => setKnobs({ ...knobs, userMaxImageDimensionPixels: e.target.value })}
                />
              </label>
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={knobs.ignoreModelPreferredMaxImageDimension}
                onChange={e => setKnobs({ ...knobs, ignoreModelPreferredMaxImageDimension: e.target.checked })}
              />
              Ignore model preferred max image dimension
            </label>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={knobs.reasoningEnabled}
                onChange={e => setKnobs({ ...knobs, reasoningEnabled: e.target.checked })}
              />
              Surface thinking / reasoning blocks
            </label>
            {knobs.reasoningEnabled ? (
              <div className="form-grid slim">
                <label>
                  Reasoning start tag
                  <input value={knobs.reasoningStart} onChange={e => setKnobs({ ...knobs, reasoningStart: e.target.value })} />
                </label>
                <label>
                  Reasoning end tag
                  <input value={knobs.reasoningEnd} onChange={e => setKnobs({ ...knobs, reasoningEnd: e.target.value })} />
                </label>
              </div>
            ) : null}

            <div className="form-grid slim">
              <label className="wide">
                Advanced overrides (JSON — e.g. toolChoice, remote MCP flags, raw KV configs)
                <textarea
                  value={advancedConfigText}
                  onChange={e => setAdvancedConfigText(e.target.value)}
                  rows={6}
                  spellCheck={false}
                />
              </label>
            </div>
            {advancedConfigError ? <div className="callout error">{advancedConfigError}</div> : null}
          </details>

          <details className="stack" open>
            <summary><h4>Message + attachments</h4></summary>
            <textarea
              className="prompt"
              value={userMessage}
              onChange={e => setUserMessage(e.target.value)}
              placeholder="Ask the model anything…"
              rows={6}
            />
            <div className="file-row">
              <label className="button ghost file-label">
                Attach images
                <input
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={e => setAttachedFiles(e.target.files ? Array.from(e.target.files) : [])}
                />
              </label>
              <div className="muted">
                {attachedFiles.length === 0
                  ? "No files attached"
                  : `${attachedFiles.length} file${attachedFiles.length === 1 ? "" : "s"} ready`}
              </div>
            </div>
            {streamError ? <div className="callout error">{streamError}</div> : null}
            {predictionStats ? (
              <div className="callout success">
                Tokens: {predictionStats.tokens}
                {predictionStats.stopReason ? ` · stop: ${predictionStats.stopReason}` : ""}
              </div>
            ) : null}
          </details>

          <details className="stack transcript" open>
            <summary><h4>Transcript</h4></summary>
            <div className="chat">
              {renderedHistory.length === 0 ? <p className="muted">No messages yet.</p> : null}
              {renderedHistory.map((message, idx) => (
                <div key={idx} className={`bubble ${message.role}`}>
                  <div className="bubble-meta">
                    <span className="chip subtle">{message.role}</span>
                  </div>
                  {message.role === "assistant" && message._reasoning ? (
                    <details className="reasoning-details" open>
                      <summary>Thinking Process</summary>
                      <div className="reasoning-content">{message._reasoning}</div>
                    </details>
                  ) : null}
                  <p>{message.content}</p>
                </div>
              ))}
            </div>
          </details>
        </div>
        </details>
      </section>
    </div>
  );
}
