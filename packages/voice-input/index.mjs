const WAV_HEADER_BYTES = 44;

export function audioFrameToPcm16(frame) {
  if (!frame || !frame.data) return Buffer.alloc(0);
  const data = frame.data instanceof Int16Array ? frame.data : new Int16Array(frame.data);
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

export function concatPcm16(chunks = []) {
  return Buffer.concat(chunks.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk || [])));
}

export function encodePcm16Wav(pcmInput, { sampleRate = 16000, channels = 1 } = {}) {
  const pcm = Buffer.isBuffer(pcmInput) ? pcmInput : concatPcm16(pcmInput);
  const byteRate = sampleRate * channels * 2;
  const blockAlign = channels * 2;
  const wav = Buffer.alloc(WAV_HEADER_BYTES + pcm.length);

  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, WAV_HEADER_BYTES);
  return wav;
}

export function encodePcm16WavBase64(chunks = [], options = {}) {
  return encodePcm16Wav(concatPcm16(chunks), options).toString("base64");
}

export function wavDurationMs(wav, { sampleRate = 16000, channels = 1 } = {}) {
  const buffer = Buffer.isBuffer(wav) ? wav : Buffer.from(wav || []);
  const dataBytes = Math.max(0, buffer.length - WAV_HEADER_BYTES);
  return Math.round((dataBytes / Math.max(1, sampleRate * channels * 2)) * 1000);
}
