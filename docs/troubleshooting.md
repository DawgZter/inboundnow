# Troubleshooting

## LiveKit Connects But No Agent Reply

Check that the token server and agent use the same `LIVEKIT_ROOM`, `LIVEKIT_URL`, and `TOKEN_SERVER_URL`. In LiveKit-only proof runs, set `ENABLE_SIM_BRIDGE=0` so a fallback cannot hide the issue.

## Browser Says LiveKit Unavailable

Confirm `livekit-server --dev` is running and listening on `ws://127.0.0.1:7880`. Run `npm run smoke:livekit` to test the transport without the browser UI.

## Mic Is Blocked Or Missing

The browser requests mic publication from `Start AI Persona` in the product path, with `Connect local transport` kept as a developer control. Mic failure does not mean Parakeet failed; it means browser audio publication was not available for the LiveKit ASR turn. In H100 proof mode, a valid run must show browser mic proof, worker audio proof, and local Parakeet endpoint provenance.

## Remote Page Target Drift

Remote.com markup can change. The payroll flow should assert visible movement/highlight and prompt behavior, not only exact DOM text.

## Cal Does Not Render Inside The Modal

Cal may block iframe behavior. The required gate is that the iframe `src` is empty before confirmation and only set after confirmation. The fallback link remains available.

## Speech Output Is Silent

Browser `speechSynthesis` is a streamed fallback. Silence can come from browser autoplay/voice availability, not from Miso One model proof. Real Miso One proof requires `TTS_PROVIDER=local-miso-one`, an H100-local compatible endpoint, and `npm run smoke:tts:miso-one` evidence. LoRA cloned-voice proof also requires a consented adapter artifact and applied-adapter evidence.

## Moss Or Model Claims Look Too Strong

Check `docs/proof-matrix.md`. Fixture retrieval, the fake TTS contract smoke, `qwen-stub`, `vibevoice-stub`, and `parakeet-stub` prove wiring only.

## H100 Setup Fails On Vast

Use docs/vast-h100-runbook.md. The bootstrap script intentionally exits unless nvidia-smi reports an H100. If Vast template setup changes, prefer the UI path: Templates -> PyTorch -> H100 offer -> direct SSH -> run scripts/vast-h100/bootstrap-instance.sh on the instance.
