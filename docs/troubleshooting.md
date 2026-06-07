# Troubleshooting

## LiveKit Connects But No Agent Reply

Check that the token server and agent use the same `LIVEKIT_ROOM`, `LIVEKIT_URL`, and `TOKEN_SERVER_URL`. In LiveKit-only proof runs, set `ENABLE_SIM_BRIDGE=0` so a fallback cannot hide the issue.

## Browser Says LiveKit Unavailable

Confirm `livekit-server --dev` is running and listening on `ws://127.0.0.1:7880`. Run `npm run smoke:livekit` to test the transport without the browser UI.

## Mic Is Blocked Or Missing

The browser requests mic publication from the `Connect local transport` action. Mic failure does not mean ASR failed, because ASR is not wired yet. It only means browser audio publication was not available in that run.

## Remote Page Target Drift

Remote.com markup can change. The payroll flow should assert visible movement/highlight and prompt behavior, not only exact DOM text.

## Cal Does Not Render Inside The Modal

Cal may block iframe behavior. The required gate is that the iframe `src` is empty before confirmation and only set after confirmation. The fallback link remains available.

## Speech Output Is Silent

Browser `speechSynthesis` is only a demo fallback. Silence is not VibeVoice proof failure because VibeVoice is not wired yet.

## Moss Or Model Claims Look Too Strong

Check `docs/proof-matrix.md`. Fixture retrieval, `qwen-stub`, `vibevoice-stub`, and `parakeet-stub` prove wiring only.

## H100 Setup Fails On Vast

Use docs/vast-h100-runbook.md. The bootstrap script intentionally exits unless nvidia-smi reports an H100. If Vast template setup changes, prefer the UI path: Templates -> PyTorch -> H100 offer -> direct SSH -> run scripts/vast-h100/bootstrap-instance.sh on the instance.
