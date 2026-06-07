#!/usr/bin/env node
import { AudioStream, Room, RoomEvent, dispose } from "@livekit/rtc-node";
import WebSocket from "ws";
import { ActionProtocolError, prepareActionsForDispatch } from "../../packages/action-protocol/index.mjs";
import { splitSpeechText } from "../../packages/speech-streaming/index.mjs";
import { audioFrameToPcm16, encodePcm16WavBase64, wavDurationMs } from "../../packages/voice-input/index.mjs";
import { detectVoiceSwitchIntent, isVoiceSwitchOnly, resolveVoiceProfile } from "../../packages/voice-session/index.mjs";
import { createAdapterRegistry, adapterLabels, adapterStatusMap } from "./adapters/registry.mjs";
import { planQuestion } from "./llm-planner.mjs";

const TOKEN_SERVER_URL = process.env.TOKEN_SERVER_URL || "http://127.0.0.1:4301";
const ROOM = process.env.LIVEKIT_ROOM || "inboundnow-local";
const IDENTITY = process.env.AGENT_IDENTITY || "inboundnow-agent";
const MODE = process.env.AGENT_MODE || "simulated";
const AGENT_TRANSPORT = process.env.AGENT_TRANSPORT || "bridge";
const CONTROL_TOPIC = process.env.LIVEKIT_CONTROL_TOPIC || "inboundnow.control.v1";
const SIMULATED_AGENT = !["verified", "real"].includes(MODE);
const adapters = createAdapterRegistry(process.env);
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let speechGeneration = 0;
const defaultVoiceProfile = resolveVoiceProfile(process.env.TTS_VOICE_PROFILE || "default");
const sessionVoiceProfiles = new Map();
const activeAsrTurns = new Map();
const ASR_SAMPLE_RATE = Number(process.env.ASR_SAMPLE_RATE || process.env.PARAKEET_SAMPLE_RATE || 16000);
const ASR_CHANNELS = Number(process.env.ASR_CHANNELS || 1);
const ASR_MAX_TURN_MS = Number(process.env.ASR_MAX_TURN_MS || 15000);

function voiceSessionKey(message = {}, context = {}) {
  return message.sessionId || message.from || context.senderIdentity || "default";
}

function messageTransport(message = {}) {
  return message.transport || AGENT_TRANSPORT;
}

function bridgeUrl() {
  const base = new URL(TOKEN_SERVER_URL);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  base.pathname = "/agent-bridge";
  base.search = new URLSearchParams({
    role: "agent",
    room: ROOM,
    identity: IDENTITY,
  }).toString();
  return base.href;
}

function tokenUrl() {
  const url = new URL("/token", TOKEN_SERVER_URL);
  url.search = new URLSearchParams({
    role: "agent",
    room: ROOM,
    identity: IDENTITY,
    name: "InboundNow Local Agent",
  }).toString();
  return url.href;
}

async function fetchAgentToken() {
  const response = await fetch(tokenUrl());
  if (!response.ok) throw new Error("Token server returned HTTP " + response.status);
  return response.json();
}

function withAgentIdentity(payload) {
  return { ...payload, from: IDENTITY };
}

function sendBridge(ws, payload) {
  ws.send(JSON.stringify(withAgentIdentity(payload)));
}

async function safeRetrieval(question) {
  if (!adapters.moss || typeof adapters.moss.query !== "function") return null;
  try {
    return await adapters.moss.query(question, { topK: 3 });
  } catch (error) {
    return {
      provider: adapters.moss.provider || "moss",
      error: error.message,
      snippets: [],
    };
  }
}

function speechStreamingEnabled() {
  return !["0", "false", "no", "off"].includes(String(process.env.TTS_STREAMING || "1").trim().toLowerCase());
}

async function sendSpeechStream(sendReply, { requestId, transport, answer, adapterStatus, voiceProfile, voiceSwitch }) {
  if (!speechStreamingEnabled() || !answer) return;

  const generation = ++speechGeneration;
  const chunks = splitSpeechText(answer, {
    textChunkChars: process.env.TTS_TEXT_CHUNK_CHARS || process.env.VIBEVOICE_TEXT_CHUNK_CHARS,
  });
  if (!chunks.length) return;

  const ttsStatus = adapterStatus.tts || {};
  await sendReply({
    type: "agent.speech.start",
    requestId,
    transport,
    provider: adapters.tts?.provider || "tts",
    label: ttsStatus.label || "",
    proof: ttsStatus.proof || "",
    streaming: true,
    mode: "text-chunks",
    fallback: "browser-speech-synthesis",
    localVibeVoiceProven: false,
    chunkCount: chunks.length,
    voiceProfile,
    voiceSwitch: voiceSwitch || null,
  });

  for (let index = 0; index < chunks.length; index += 1) {
    if (generation !== speechGeneration) break;
    await sendReply({
      type: "agent.speech.chunk",
      requestId,
      transport,
      provider: adapters.tts?.provider || "tts",
      sequence: index,
      text: chunks[index],
      voiceProfile,
    });
  }

  if (generation === speechGeneration) {
    await sendReply({
      type: "agent.speech.end",
      requestId,
      transport,
      provider: adapters.tts?.provider || "tts",
      chunkCount: chunks.length,
      voiceProfile,
    });
  }
}

async function handleQuestion(sendReply, message, context = {}) {
  const question = message.question || message.text || "";
  const retrieval = await safeRetrieval(question);
  const requestId = message.id || "";
  const responseTransport = message.transport || AGENT_TRANSPORT;
  const sessionId = voiceSessionKey(message, context);
  const adapterStatus = adapterStatusMap(adapters);
  const generateId = () => "act_" + Math.random().toString(36).slice(2, 10);
  const currentVoiceProfile = sessionVoiceProfiles.get(sessionId) || defaultVoiceProfile;
  const incomingVoiceProfile = message.voiceProfile ? resolveVoiceProfile(message.voiceProfile, currentVoiceProfile) : currentVoiceProfile;
  const voiceSwitch = detectVoiceSwitchIntent(question, incomingVoiceProfile);
  const activeVoiceProfile = voiceSwitch.changed ? voiceSwitch.profile : incomingVoiceProfile;
  sessionVoiceProfiles.set(sessionId, activeVoiceProfile);
  const voiceSwitchMetadata = voiceSwitch.reason
    ? {
        changed: voiceSwitch.changed,
        reason: voiceSwitch.reason,
        acknowledgement: voiceSwitch.acknowledgement,
      }
    : null;
  const planResult = isVoiceSwitchOnly(question) && voiceSwitch.reason
    ? {
        planner: { source: "voice-session-router", provider: "local-rule", fallback: false },
        plan: {
          intent: "voice_switch",
          answer: voiceSwitch.acknowledgement,
          actions: [
            {
              type: "showCaption",
              text: voiceSwitch.acknowledgement,
            },
          ],
        },
        preparedActions: null,
      }
    : await planQuestion({
    question,
    retrieval,
    pageSnapshot: message.pageSnapshot,
    bookingState: message.bookingState || "none",
    adapters,
    env: process.env,
    generateId,
  });
  const plan = planResult.plan;
  if (voiceSwitch.changed && plan.intent !== "voice_switch") {
    plan.answer = voiceSwitch.acknowledgement + " " + plan.answer;
  }
  let actions = planResult.preparedActions;

  try {
    if (!Array.isArray(actions) || !actions.length) {
      actions = prepareActionsForDispatch(plan.actions, {
        bookingState: message.bookingState || "none",
        generateId,
      });
    }
  } catch (error) {
    await sendReply({
      type: "agent.error",
      requestId,
      code: error instanceof ActionProtocolError ? "invalid_action_plan" : "planner_error",
      message: error.message,
      details: error.details || {},
    });
    return;
  }

  await sendReply({
    type: "agent.answer",
    requestId,
    sessionId,
    transport: responseTransport,
    intent: plan.intent,
    answer: plan.answer,
    simulated: SIMULATED_AGENT,
    adapters: adapterLabels(adapters),
    adapterStatus,
    planner: planResult.planner,
    voiceProfile: activeVoiceProfile,
    voiceSwitch: voiceSwitchMetadata,
    retrieval: retrieval
      ? {
          provider: retrieval.provider || "",
          simulated: !!retrieval.simulated,
          count: Array.isArray(retrieval.snippets) ? retrieval.snippets.length : 0,
          snippets: Array.isArray(retrieval.snippets) ? retrieval.snippets.slice(0, 3) : [],
        }
      : null,
  });

  await sendSpeechStream(sendReply, {
    requestId,
    transport: responseTransport,
    answer: plan.answer,
    adapterStatus,
    voiceProfile: activeVoiceProfile,
    voiceSwitch: voiceSwitchMetadata,
  });

  for (const action of actions) {
    await sendReply({
    type: "agent.action",
      requestId,
      sessionId,
      transport: responseTransport,
      action,
    });
  }
}

async function sendAsrStatus(sendReply, message, context, status, detail = {}) {
  const sessionId = voiceSessionKey(message, context);
  await sendReply({
    type: "agent.asr.status",
    requestId: message.id || message.requestId || "",
    sessionId,
    transport: messageTransport(message),
    status,
    provider: adapters.asr?.provider || "asr",
    asr: adapterStatusMap(adapters).asr,
    ...detail,
  });
}

async function handleFinalTranscript(sendReply, message, context = {}, transcriptResult = {}) {
  const transcript = String(transcriptResult.transcript || message.transcript || message.text || message.question || "").trim();
  const requestId = message.id || message.requestId || "";
  const sessionId = voiceSessionKey(message, context);
  const transport = messageTransport(message);

  if (!transcript) {
    await sendAsrStatus(sendReply, message, context, "empty_transcript", {
      message: "No transcript text was available for this voice turn.",
    });
    return;
  }

  await sendReply({
    type: "agent.asr.final",
    requestId,
    sessionId,
    transport,
    transcript,
    provider: transcriptResult.provider || message.provider || "browser-transcript",
    model: transcriptResult.model || "",
    language: transcriptResult.language || message.language || "en",
    confidence: transcriptResult.confidence ?? null,
    simulated: transcriptResult.simulated ?? message.simulated ?? true,
    proof: transcriptResult.proof || "transcript-message",
    source: message.source || transcriptResult.source || "browser-transcript",
  });

  await handleQuestion(sendReply, {
    ...message,
    id: requestId,
    type: "prospect.question",
    question: transcript,
    text: transcript,
    transport,
    sessionId,
    simulatedVoice: transcriptResult.simulated ?? message.simulated ?? true,
    asr: {
      provider: transcriptResult.provider || message.provider || "browser-transcript",
      model: transcriptResult.model || "",
      proof: transcriptResult.proof || "transcript-message",
      simulated: transcriptResult.simulated ?? message.simulated ?? true,
    },
  }, context);
}

async function transcribeAudioTurn(sendReply, message, context = {}, audioInput = {}) {
  const requestId = message.id || message.requestId || "asr_" + Math.random().toString(36).slice(2, 10);
  const sessionId = voiceSessionKey(message, context);
  await sendAsrStatus(sendReply, { ...message, id: requestId, sessionId }, context, "transcribing", {
    message: "Sending local audio turn to ASR adapter.",
  });

  try {
    const result = await adapters.asr.transcribe({
      requestId,
      audioBase64: audioInput.audioBase64 || message.audioBase64 || "",
      audioPath: audioInput.audioPath || message.audioPath || "",
      mimeType: audioInput.mimeType || message.mimeType || "audio/wav",
      sampleRate: Number(audioInput.sampleRate || message.sampleRate || ASR_SAMPLE_RATE),
      language: audioInput.language || message.language || "en",
      timestamps: message.timestamps !== false,
    });
    await handleFinalTranscript(sendReply, {
      ...message,
      id: requestId,
      sessionId,
      source: message.source || "local-audio-turn",
    }, context, {
      ...result,
      proof: adapterStatusMap(adapters).asr?.proof || "configured",
      simulated: result.simulated === true ? true : false,
      source: message.source || "local-audio-turn",
    });
  } catch (error) {
    await sendReply({
      type: "agent.error",
      requestId,
      sessionId,
      transport: messageTransport(message),
      code: "asr_transcribe_error",
      message: error.message,
    });
  }
}

async function stopAsrTurn(sendReply, message, context = {}) {
  const sessionId = voiceSessionKey(message, context);
  const turn = activeAsrTurns.get(sessionId);
  activeAsrTurns.delete(sessionId);

  if (!turn || !turn.chunks.length) {
    await sendAsrStatus(sendReply, message, context, "no_audio", {
      message: "No LiveKit audio frames were buffered for this voice turn.",
    });
    return;
  }

  const audioBase64 = encodePcm16WavBase64(turn.chunks, {
    sampleRate: turn.sampleRate || ASR_SAMPLE_RATE,
    channels: turn.channels || ASR_CHANNELS,
  });
  await transcribeAudioTurn(sendReply, {
    ...message,
    id: message.id || turn.requestId,
    sessionId,
    source: "livekit-audio-turn",
  }, context, {
    audioBase64,
    mimeType: "audio/wav",
    sampleRate: turn.sampleRate || ASR_SAMPLE_RATE,
    durationMs: wavDurationMs(Buffer.from(audioBase64, "base64"), {
      sampleRate: turn.sampleRate || ASR_SAMPLE_RATE,
      channels: turn.channels || ASR_CHANNELS,
    }),
  });
}

function startAsrTurn(sendReply, message, context = {}) {
  const sessionId = voiceSessionKey(message, context);
  const requestId = message.id || message.requestId || "asr_" + Math.random().toString(36).slice(2, 10);
  activeAsrTurns.set(sessionId, {
    requestId,
    chunks: [],
    sampleRate: ASR_SAMPLE_RATE,
    channels: ASR_CHANNELS,
    startedAt: Date.now(),
  });
  sendAsrStatus(sendReply, { ...message, id: requestId, sessionId }, context, "listening", {
    message: "Voice turn started; buffering LiveKit mic frames when available.",
  }).catch(() => {});
}

function bufferAudioFrame(sessionId, frame) {
  const turn = activeAsrTurns.get(sessionId);
  if (!turn) return;
  if (Date.now() - turn.startedAt > ASR_MAX_TURN_MS) {
    activeAsrTurns.delete(sessionId);
    return;
  }
  const chunk = audioFrameToPcm16(frame);
  if (!chunk.length) return;
  turn.sampleRate = frame.sampleRate || turn.sampleRate || ASR_SAMPLE_RATE;
  turn.channels = frame.channels || turn.channels || ASR_CHANNELS;
  turn.chunks.push(chunk);
}

function attachLiveKitAudioTrack(track, participant) {
  const participantIdentity = participant?.identity || "default";
  const stream = new AudioStream(track, {
    sampleRate: ASR_SAMPLE_RATE,
    numChannels: ASR_CHANNELS,
  });
  const reader = stream.getReader();
  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bufferAudioFrame(participantIdentity, value);
      }
    } catch (error) {
      console.error("LiveKit audio stream failed:", participantIdentity, error.message);
    } finally {
      try { reader.releaseLock(); } catch {}
    }
  })();
}

function handleControlMessage(sendReply, raw, context = {}) {
  let message;
  try {
    message = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return;
  }

  if (message.type === "prospect.question") {
    console.log("agent.question", message.transport || AGENT_TRANSPORT, message.id || "", CONTROL_TOPIC);
    handleQuestion(sendReply, message, context).catch((error) => {
      sendReply({
        type: "agent.error",
        requestId: message.id || "",
        code: "question_handler_error",
        message: error.message,
      }).catch(() => {});
    });
    return;
  }

  if (message.type === "prospect.transcript.final") {
    console.log("agent.transcript.final", message.transport || AGENT_TRANSPORT, message.id || "", CONTROL_TOPIC);
    handleFinalTranscript(sendReply, message, context, {
      transcript: message.transcript || message.text || "",
      provider: message.provider || "browser-transcript",
      language: message.language || "en",
      simulated: message.simulated !== false,
      proof: "transcript-message",
      source: message.source || "typed-fallback",
    }).catch((error) => {
      sendReply({
        type: "agent.error",
        requestId: message.id || "",
        code: "transcript_handler_error",
        message: error.message,
      }).catch(() => {});
    });
    return;
  }

  if (message.type === "prospect.audio") {
    console.log("agent.audio", message.transport || AGENT_TRANSPORT, message.id || "", CONTROL_TOPIC);
    transcribeAudioTurn(sendReply, message, context).catch((error) => {
      sendReply({
        type: "agent.error",
        requestId: message.id || "",
        code: "asr_handler_error",
        message: error.message,
      }).catch(() => {});
    });
    return;
  }

  if (message.type === "prospect.asr.start") {
    startAsrTurn(sendReply, message, context);
    return;
  }

  if (message.type === "prospect.asr.stop") {
    stopAsrTurn(sendReply, message, context).catch((error) => {
      sendReply({
        type: "agent.error",
        requestId: message.id || message.requestId || "",
        code: "asr_stop_error",
        message: error.message,
      }).catch(() => {});
    });
    return;
  }

  if (message.type === "session.voice_profile.updated") {
    const sessionId = voiceSessionKey(message, context);
    const voiceProfile = resolveVoiceProfile(message.voiceProfile, sessionVoiceProfiles.get(sessionId) || defaultVoiceProfile);
    sessionVoiceProfiles.set(sessionId, voiceProfile);
    sendReply({
      type: "agent.status",
      status: "voice_profile_updated",
      sessionId,
      voiceProfile,
      message: "Voice profile updated to " + voiceProfile.label + ".",
    }).catch(() => {});
    return;
  }

  if (message.type === "booking.confirmed") {
    sendReply({
      type: "agent.status",
      status: "booking_confirmed",
      message: "Browser confirmed booking; Cal can open in-page.",
    }).catch(() => {});
    return;
  }

  if (message.type === "prospect.interrupt") {
    speechGeneration += 1;
    activeAsrTurns.delete(voiceSessionKey(message, context));
    sendReply({
      type: "agent.status",
      status: "interrupted",
      message: "Prospect interrupted; pending streamed speech chunks were cancelled.",
    }).catch(() => {});
    return;
  }

  if (message.type === "browser.event" && message.event) {
    const actionId = message.event.detail?.id || message.event.detail?.target || "";
    console.log("browser.event", message.event.type, actionId);
  }
}

function connectBridge() {
  const ws = new WebSocket(bridgeUrl());

  ws.on("open", () => {
    sendBridge(ws, {
      type: "agent.status",
      status: "online",
      mode: MODE,
      transport: "bridge",
      message: "Local simulated agent worker connected.",
    });
  });

  ws.on("message", (raw) => {
    handleControlMessage(async (payload) => sendBridge(ws, payload), String(raw), { transport: "bridge" });
  });

  ws.on("close", () => {
    console.log("Agent bridge disconnected. Reconnecting in 1500ms...");
    setTimeout(connectBridge, 1500);
  });

  ws.on("error", (error) => {
    console.error("Agent bridge error:", error.message);
  });
}

async function connectLiveKit() {
  const tokenPayload = await fetchAgentToken();
  const room = new Room();

  async function publish(payload, participant) {
    const options = {
      reliable: true,
      topic: CONTROL_TOPIC,
    };
    if (participant?.identity) options.destination_identities = [participant.identity];
    await room.localParticipant.publishData(
      encoder.encode(JSON.stringify(withAgentIdentity(payload))),
      options,
    );
  }

  room.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
    if (topic && topic !== CONTROL_TOPIC) return;
    const decoded = decoder.decode(payload);
    handleControlMessage((reply) => publish(reply, participant), decoded, {
      transport: "livekit",
      senderIdentity: participant?.identity || "",
    });
  });

  room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    console.log("livekit.trackSubscribed", participant?.identity || "", publication?.source || track?.kind || "");
    if (String(track?.kind || "").toLowerCase().includes("audio") || String(publication?.source || "").toLowerCase().includes("microphone")) {
      attachLiveKitAudioTrack(track, participant);
    }
  });

  room.on(RoomEvent.Disconnected, () => {
    console.log("LiveKit agent room disconnected. Reconnecting in 1500ms...");
    setTimeout(() => {
      connectLiveKit().catch((error) => console.error("LiveKit reconnect failed:", error.message));
    }, 1500);
  });

  await room.connect(tokenPayload.livekitUrl, tokenPayload.token, {
    autoSubscribe: true,
    dynacast: false,
  });

  await publish({
    type: "agent.status",
    status: "online",
    mode: MODE,
    transport: "livekit",
    message: "Local LiveKit agent worker connected. Voice ASR is not attached yet.",
  });

  console.log("LiveKit agent connected:", tokenPayload.livekitUrl, ROOM, IDENTITY);
}

console.log("InboundNow agent worker starting");
console.log("Mode:", MODE);
console.log("Transport:", AGENT_TRANSPORT);
console.log("Room:", ROOM);

if (AGENT_TRANSPORT === "livekit") {
  connectLiveKit().catch((error) => {
    console.error("LiveKit agent connection failed:", error.message);
    setTimeout(() => {
      connectLiveKit().catch((retryError) => console.error("LiveKit retry failed:", retryError.message));
    }, 1500);
  });
} else {
  console.log("Bridge:", bridgeUrl());
  connectBridge();
}

process.on("SIGINT", () => {
  try {
    dispose();
  } finally {
    process.exit(0);
  }
});
