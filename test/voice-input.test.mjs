import assert from "node:assert/strict";
import { test } from "node:test";
import {
  audioFrameToPcm16,
  concatPcm16,
  encodePcm16Wav,
  encodePcm16WavBase64,
  wavDurationMs,
} from "../packages/voice-input/index.mjs";

test("voice input helpers encode PCM16 frames as mono wav payloads", () => {
  const frame = {
    sampleRate: 16000,
    channels: 1,
    samplesPerChannel: 4,
    data: new Int16Array([1, -1, 2, -2]),
  };
  const pcm = audioFrameToPcm16(frame);
  assert.equal(pcm.length, 8);
  assert.equal(concatPcm16([pcm, pcm]).length, 16);

  const wav = encodePcm16Wav(pcm, { sampleRate: 16000, channels: 1 });
  assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE");
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt32LE(40), 8);
  assert.equal(wavDurationMs(wav, { sampleRate: 16000, channels: 1 }), 0);

  const encoded = encodePcm16WavBase64([pcm], { sampleRate: 16000, channels: 1 });
  assert.equal(Buffer.from(encoded, "base64").subarray(0, 4).toString("ascii"), "RIFF");
});
