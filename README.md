# n8n-nodes-litellm

An [n8n](https://n8n.io) community node for the [LiteLLM](https://docs.litellm.ai/) proxy API.

Message the models configured on your LiteLLM proxy, read spend, and put a **budget check** in front of expensive steps, so a workflow that loops or runs too often stops early instead of using up the budget.

For plain chat you can also point n8n's OpenAI nodes at the proxy. This node adds what they can't do: read key and proxy spend from LiteLLM, and stop a workflow before it goes over budget.

## Installation

On self-hosted n8n, go to **Settings → Community Nodes → Install** and enter `n8n-nodes-litellm`. See the [community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) for details. On n8n Cloud, community nodes are available once n8n has verified them.

## Credentials

Create a **LiteLLM API** credential:

- **Base URL**: the root URL of your proxy, e.g. `https://llm.example.com` or `http://127.0.0.1:4000`. A trailing `/` or `/v1` is removed, because LiteLLM's spend endpoints have no `/v1` prefix. Without a scheme, `https://` is added, or `http://` for `localhost` and `127.0.0.1`.
- **API Key**: a [virtual key](https://docs.litellm.ai/docs/proxy/virtual_keys), or the master key for proxy-wide spend.

> Use `127.0.0.1` rather than `localhost`: n8n may resolve `localhost` to IPv6, while LiteLLM listens on IPv4 by default. If n8n runs in Docker, use the proxy's service name or `host.docker.internal`.

The credential test calls `GET /models`.

## Operations

| Resource | Operation       | Output                                                                                           |
| -------- | --------------- | ------------------------------------------------------------------------------------------------ |
| Budget   | Check           | `status` (`ok`, `warn`, `over`, `no_budget`), `allowed`, `message`, the Spend fields, `lastStep` |
| Chat     | Message a Model | With **Simplify**: `text`, `finishReason`, `model` and token counts                              |
| Model    | Get Many        | The models the key can call                                                                      |
| Spend    | Get             | `source`, `spend`, `maxBudget`, `remaining`, `usedPercent`, `budgetDuration`, `budgetResetAt`    |

Chat sends a prompt, with an optional system prompt, to a model on the proxy. Temperature and Max Tokens are only sent when set.

The node can also be used as a tool by n8n AI agents. For Budget → Check as a tool, keep **When Over Budget** on **Return Status** so the agent receives the decision.

### Spend source

Budget and Spend read from one of two places:

| Source                | Endpoint                                      | Key needed                        |
| --------------------- | --------------------------------------------- | --------------------------------- |
| Current Key (default) | `GET /key/info`                               | the virtual key in the credential |
| Whole Proxy           | `GET /user/info?user_id=litellm-proxy-budget` | an admin key, e.g. the master key |

**Current Key** reads the key's own budget, or the budget tier linked to it with `budget_id`. Team, user, per-model, multi-window (`budget_limits`) and proxy-wide budgets are not included; add a Whole Proxy check if you use a proxy budget. The master key has no key record and gets a 404.

**Whole Proxy** reads the record LiteLLM keeps for `litellm_settings.max_budget` (LiteLLM requires `budget_duration` with it). Without `max_budget` LiteLLM does not count proxy-wide spend, so the result is `no_budget` with `spend: null`. The record's `max_budget` is copied from the config when LiteLLM starts, so restart LiteLLM after changing it. If you remove `max_budget`, the old record stays and this node keeps reporting against it while LiteLLM no longer enforces it; delete the user `litellm-proxy-budget` to clear it.

`spend` covers the current budget window, and `budgetResetAt` says when the next one starts. Keep in mind:

- LiteLLM enforces budgets from an in-memory counter but writes spend to its database in batches, every `general_settings.proxy_batch_write_at` seconds (10 by default) plus up to 5 seconds. The value read here can trail by that much; set the safety margin above what your workflows spend in that time.
- LiteLLM's reset job runs about every 10 minutes, so spend can stay at the old value for up to 10 minutes after `budgetResetAt`.

### Budget → Check

| Setting               | Default       |
| --------------------- | ------------- |
| When Over Budget      | Return Status |
| Warn At (% of Budget) | 80            |
| Safety Margin ($)     | 0             |
| Alert Step ($)        | 10            |

- **When Over Budget**: **Return Status** outputs `allowed: false` for an IF node. **Fail Node** stops the workflow at this node. With _On Error → Continue (using error output)_ the item goes to the error output instead, with the decision under `details`.
- **Warn At**: `status` becomes `warn` from this share of the budget.
- **Safety Margin**: `status` becomes `over` once the remaining budget is at or below this amount.
- **Alert Step**: `lastStep` is the highest multiple of this amount already spent (10, 20, 30 …). Store it, e.g. in workflow static data, and alert when it changes. `0` turns it off.

A key budget of `0` blocks everything, so it is reported as `over`. For the proxy budget LiteLLM blocks once spend is above `max_budget`, while this node reports `over` from the moment spend reaches it. A response that is not a LiteLLM spend record fails the node. Options filled in by expressions are validated, and the node fails if one is not a valid number; a blank value uses the default.

Spend, Budget and Model send one request per input item. Turn on **Execute Once** in the node settings when the input has many items.

With _On Error → Continue_, LiteLLM errors become items with `error` and `message` that keep the link to their input item. Errors found before a request is sent (an empty prompt or an invalid option value) also reach the error output, but n8n does not link those to the input item.

## Example

[`examples/budget-guarded-chat.json`](examples/budget-guarded-chat.json) is a workflow you can import: **Budget → Check** (Fail Node, $1 safety margin) runs before **Chat → Message a Model**, so the model is only called while budget is left. Select your credential on both nodes and set a model that exists on your proxy.

## Compatibility

Tested with n8n 2.43.7 and LiteLLM 1.105.1 (node API version 1).

## Development

```bash
npm ci
npm test              # builds, then runs the tests in test/
npm run lint          # n8n community node lint rules
npm run format:check  # prettier
npm run dev           # starts n8n with the node loaded
```

The node is declarative, with one folder per resource under `nodes/LiteLlm/resources/`; each folder has the UI description in `index.ts` and its response hooks in `hooks.ts`. Shared code lives in `nodes/LiteLlm/shared/`:

- `budget.ts` reads LiteLLM spend records and makes the budget decision (pure functions, no n8n imports)
- `spend.ts` holds what Spend and Budget share: the source field, the request and the response check
- `options.ts` validates numeric options that may come from expressions
- `errors.ts` turns LiteLLM error responses into n8n errors with LiteLLM's own message
- `items.ts` pairs output items with the input item they came from

The tests run against the built files in `dist/`.

## License

MIT, see [LICENSE.md](LICENSE.md).
