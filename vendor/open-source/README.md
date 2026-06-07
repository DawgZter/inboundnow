# inboundnow vendored OSS

This directory vendors shallow source snapshots that are relevant to the inboundnow local voice-agent stack.

- stagehand: semantic browser action resolution for arbitrary sites.
- voicebox: voice product surface and local voice UX reference material.
- vllm: H100-oriented local Qwen-class serving, paged attention, cache management, and throughput work.
- flashinfer: GPU attention/sampling kernels relevant to low-latency H100 inference.
- llm-awq: quantization reference code for lower-latency local LLM serving.
- Qwen3: Qwen model family reference implementation and docs.
- llm-compressor: quantization/compression tooling useful for H100 deployment experiments.

The active inboundnow runtime does not import these packages directly yet. They are checked in as local source references for the browser automation, voice, quantization, and H100 optimization lanes.

