# Result Handling

Treat `kci result <job-id>` as source-of-truth output.

- `kci result <job-id>` returns rendered Markdown for humans.
- `kci result --json <job-id>` returns the full job record with `result`, `rendered`, `raw`, logs, and errors.
- Preserve concrete copy, UX constraints, visual constraints, candidate file names, and validation checklists.
- If `parse_status` is `raw-fallback`, relay useful raw output and say the CLI used raw fallback.
- If `parse_status` is `extracted`, mention that JSON was extracted from mixed Kimi output if it matters to trust.
- Never claim Kimi was consulted unless a real `kci`, `kimi`, or Ollama command actually ran.
- Never claim Kimi saw an image unless `routing.image_delivery_confirmed: true` is present and the response matches the image task. For `kci code --image`, also check `routing.image_delivery_route`.
- `image_delivery_confirmed: true` means the selected route did not report a read/delivery failure; it is not by itself proof that Kimi analyzed every relevant visual detail. For real UI review, the answer must reference visible content consistently with the screenshot.

Kimi output is a brief or candidate, not an automatic patch. Codex applies, edits, and verifies.
