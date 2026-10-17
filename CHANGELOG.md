# Changelog

## 0.2.0 (2026-10-17)

First release. Versions 0.1.x of this npm name were published and withdrawn by an earlier, unrelated package, and npm does not allow reusing them.

- Chat → Message a Model with the model list from the proxy, optional system prompt, temperature and max tokens, simplified output
- Model → Get Many with Return All / Limit
- Spend → Get for the current key (`/key/info`, including budget tiers) or the whole proxy (`/user/info?user_id=litellm-proxy-budget`)
- Budget → Check with `ok` / `warn` / `over` / `no_budget`, safety margin, alert steps and an option to fail the node
- LiteLLM error messages are shown in n8n, with hints for the spend endpoints
- Base URLs ending in `/` or `/v1`, or without a scheme, work (`https://` is assumed except for loopback hosts)
- Output items stay paired with their input items, also on the error output
