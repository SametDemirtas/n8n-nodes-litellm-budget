import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { checkSpendResponse } = require('../dist/nodes/LiteLlm/shared/spend.js');
const { toBudgetDecision } = require('../dist/nodes/LiteLlm/resources/budget/hooks.js');
const { toSpendItem } = require('../dist/nodes/LiteLlm/resources/spend/hooks.js');
const {
	expectArray,
	guarded,
	throwOnHttpError,
} = require('../dist/nodes/LiteLlm/shared/errors.js');
const { pairWithInput } = require('../dist/nodes/LiteLlm/shared/items.js');
const { buildChatBody, simplifyChat } = require('../dist/nodes/LiteLlm/resources/chat/hooks.js');
const { listModels } = require('../dist/nodes/LiteLlm/resources/model/hooks.js');

// Stand-in for n8n's per-item execution context. Like n8n, a missing or undefined parameter returns the fallback.
function context(params, { continueOnFail = false, itemIndex = 0 } = {}) {
	return {
		getNodeParameter: (name, fallback) => params[name] ?? fallback,
		getNode: () => ({
			name: 'LiteLLM',
			type: 'n8n-nodes-litellm-budget.liteLlm',
			typeVersion: 1,
			parameters: {},
		}),
		getItemIndex: () => itemIndex,
		continueOnFail: () => continueOnFail,
	};
}
const ok = (body) => ({ statusCode: 200, body });
const overKey = ok({ info: { spend: 6, max_budget: 5 } });

test('budget check returns the decision when allowed', async () => {
	const [item] = await toBudgetDecision.call(
		context({ source: 'key' }),
		[],
		ok({ info: { spend: 1, max_budget: 5 } }),
	);
	assert.equal(item.json.status, 'ok');
	assert.equal(item.json.source, 'key');
});

test('budget options are read from the collection', async () => {
	const ctx = context({ source: 'key', options: { warnAtPercent: 10, alertStep: 0 } });
	const [item] = await toBudgetDecision.call(ctx, [], ok({ info: { spend: 1, max_budget: 5 } }));
	assert.equal(item.json.status, 'warn');
	assert.equal(item.json.lastStep, null);
});

test('budget options from expressions are validated', async () => {
	for (const [name, value, label] of [
		['safetyMargin', -1, 'Safety Margin ($)'],
		['warnAtPercent', 'abc', 'Warn At (% of Budget)'],
		['alertStep', '0x10', 'Alert Step ($)'],
	]) {
		const ctx = context({ source: 'key', options: { [name]: value } });
		await assert.rejects(
			() => toBudgetDecision.call(ctx, [], overKey),
			(error) => error.message === `Invalid value for '${label}'`,
		);
	}
	const spentOne = ok({ info: { spend: 1, max_budget: 5 } });
	const fromString = context({ source: 'key', options: { warnAtPercent: '10' } });
	assert.equal((await toBudgetDecision.call(fromString, [], spentOne))[0].json.status, 'warn');
	const blank = context({ source: 'key', options: { warnAtPercent: ' ', alertStep: '' } });
	const [item] = await toBudgetDecision.call(blank, [], spentOne);
	assert.equal(item.json.status, 'ok');
	assert.equal(item.json.lastStep, 0);
});

test('Return Status outputs allowed = false', async () => {
	const [item] = await toBudgetDecision.call(
		context({ source: 'key', onOver: 'output' }),
		[],
		overKey,
	);
	assert.equal(item.json.allowed, false);
	assert.equal(item.json.error, undefined);
});

test('Fail Node throws with the decision in the description', async () => {
	await assert.rejects(
		() => toBudgetDecision.call(context({ source: 'key', onOver: 'stop' }), [], overKey),
		(error) => {
			assert.equal(error.message, 'LiteLLM budget limit reached');
			assert.equal(
				error.description,
				'over: spent $6.00 of $5.00 (120.0%), $1.00 over. Raise the budget in LiteLLM.',
			);
			return true;
		},
	);
});

test('Fail Node suggests a lower safety margin when budget is left', async () => {
	const ctx = context({ source: 'key', onOver: 'stop', options: { safetyMargin: 1 } });
	await assert.rejects(
		() => toBudgetDecision.call(ctx, [], ok({ info: { spend: 4.5, max_budget: 5 } })),
		(error) => error.description.endsWith("Raise the budget in LiteLLM or lower 'Safety Margin'."),
	);
});

test('Fail Node with On Error set to continue returns an error item with the details', async () => {
	const ctx = context({ source: 'key', onOver: 'stop' }, { continueOnFail: true });
	const [item] = await toBudgetDecision.call(ctx, [], overKey);
	assert.deepEqual(Object.keys(item.json), ['error', 'message', 'details']);
	assert.equal(item.json.error, 'LiteLLM budget limit reached');
	assert.equal(item.json.details.status, 'over');
	assert.equal(item.error, undefined);
});

test('spend item for the whole proxy', async () => {
	const body = {
		user_info: {
			spend: 12,
			max_budget: 60,
			budget_duration: '30d',
			budget_reset_at: '2026-11-01T00:00:00Z',
		},
	};
	const [item] = await toSpendItem.call(context({ source: 'proxy' }), [], ok(body));
	assert.deepEqual(item.json, {
		source: 'proxy',
		spend: 12,
		maxBudget: 60,
		remaining: 48,
		usedPercent: 20,
		budgetDuration: '30d',
		budgetResetAt: '2026-11-01T00:00:00Z',
	});
});

test('404 for the proxy budget record yields no_budget', async () => {
	const response = {
		statusCode: 404,
		body: { error: { message: 'User litellm-proxy-budget not found', code: '404' } },
	};
	const ctx = context({ source: 'proxy' });
	const items = await checkSpendResponse.call(ctx, [{ json: {} }], response);
	const [item] = await toBudgetDecision.call(ctx, items, response);
	assert.equal(item.json.status, 'no_budget');
	assert.equal(item.json.allowed, true);
	assert.equal(item.json.spend, null);
});

test('spend errors get a hint that matches the cause', async () => {
	const cases = [
		['proxy', 403, "key not allowed to access this user's info", /needs an admin key/],
		['proxy', 401, 'Authentication Error, Invalid proxy server token passed', /Check 'API Key'/],
		['proxy', 401, 'Authentication Error, Key is blocked', /Check 'API Key'/],
		['key', 401, 'Authentication Error - Expired Key', /Check 'API Key'/],
		['key', 404, 'Key not found in database', /master key has no key record/],
	];
	for (const [source, statusCode, message, hint] of cases) {
		const response = { statusCode, body: { error: { message } } };
		await assert.rejects(
			() => checkSpendResponse.call(context({ source }), [], response),
			(error) => hint.test(error.description) && error.message === message,
		);
	}
	const notLiteLlm = { statusCode: 404, body: { detail: 'Not Found' } };
	await assert.rejects(
		() => checkSpendResponse.call(context({ source: 'key' }), [], notLiteLlm),
		(error) => error.description === undefined,
	);
});

test('a valid spend response passes through unchanged', async () => {
	const items = [{ json: {} }];
	const ctx = context({ source: 'key' });
	assert.equal(await checkSpendResponse.call(ctx, items, ok({ info: { spend: 1 } })), items);
});

test('responses from another web server are rejected', async () => {
	const ctx = context({ source: 'proxy' });
	await assert.rejects(
		() => checkSpendResponse.call(ctx, [], ok('<html>app</html>')),
		/Unexpected response from LiteLLM/,
	);
	await assert.rejects(
		() => checkSpendResponse.call(ctx, [], ok({ ok: true })),
		/Unexpected response from LiteLLM/,
	);
	await assert.rejects(
		() => checkSpendResponse.call(ctx, [], { statusCode: 404, body: '<html>Not Found</html>' }),
		/HTTP 404/,
	);
});

test('generic HTTP errors carry the LiteLLM message', async () => {
	const response = {
		statusCode: 400,
		body: { error: { message: 'Invalid model name passed in model=x' } },
	};
	await assert.rejects(
		() => throwOnHttpError.call(context({}), [], response),
		/Invalid model name/,
	);
	const items = [{ json: {} }];
	assert.equal(await throwOnHttpError.call(context({}), items, ok({})), items);
	const validation = {
		statusCode: 422,
		body: { detail: [{ loc: ['query', 'user_id'], msg: 'field required' }] },
	};
	await assert.rejects(() => throwOnHttpError.call(context({}), [], validation), /field required/);
});

test('masked keys and key hashes are removed from error output', async () => {
	const message =
		'Authentication Error, Invalid proxy server token passed. Received API Key = sk-...abcd, Key Hash (Token) = 9f8e7d6c';
	const response = { statusCode: 401, body: { error: { message } } };
	await assert.rejects(
		() => throwOnHttpError.call(context({}), [], response),
		(error) =>
			!/abcd|9f8e7d6c/.test(error.message) &&
			!/abcd|9f8e7d6c/.test(JSON.stringify(error.errorResponse ?? {})),
	);
});

test('chat and model responses must have their array', async () => {
	await assert.rejects(
		() => expectArray('choices').call(context({}), [], ok('<html></html>')),
		/Unexpected response/,
	);
	await assert.rejects(
		() => expectArray('data').call(context({}), [], ok({})),
		/Unexpected response/,
	);
	const items = [{ json: {} }];
	assert.equal(await expectArray('choices').call(context({}), items, ok({ choices: [] })), items);
});

test('chat body: messages and options per item', async () => {
	const ctx = context({
		prompt: 'hello',
		systemPrompt: 'be short',
		options: { temperature: '0.5', maxTokens: 7 },
	});
	const request = await buildChatBody.call(ctx, { body: { model: 'm' } });
	assert.deepEqual(request.body, {
		model: 'm',
		messages: [
			{ role: 'system', content: 'be short' },
			{ role: 'user', content: 'hello' },
		],
		temperature: 0.5,
		max_tokens: 7,
	});
});

test('chat body: blank system prompt and unset options are left out', async () => {
	const ctx = context({
		prompt: 'hello',
		systemPrompt: '   ',
		options: { temperature: '', maxTokens: '  ' },
	});
	const request = await buildChatBody.call(ctx, { body: { model: 'm' } });
	assert.deepEqual(request.body, { model: 'm', messages: [{ role: 'user', content: 'hello' }] });
});

test('chat body: numbers and objects in the prompt are sent as text', async () => {
	const numeric = await buildChatBody.call(context({ prompt: 42 }), { body: {} });
	assert.equal(numeric.body.messages[0].content, '42');
	const object = await buildChatBody.call(context({ prompt: { a: 1 } }), { body: {} });
	assert.equal(object.body.messages[0].content, '{"a":1}');
});

test('chat body: empty prompts and bad options are rejected before the request', async () => {
	for (const prompt of ['', '   ', undefined, null]) {
		await assert.rejects(
			() => buildChatBody.call(context({ prompt }), { body: {} }),
			/Prompt is empty/,
		);
	}
	await assert.rejects(
		() => buildChatBody.call(context({ prompt: 'x', options: { temperature: 3 } }), { body: {} }),
		/Invalid value for 'Temperature'/,
	);
	await assert.rejects(
		() =>
			buildChatBody.call(context({ prompt: 'x', options: { maxTokens: 'many' } }), { body: {} }),
		/Invalid value for 'Max Tokens'/,
	);
	for (const maxTokens of [1.5, '0x10']) {
		await assert.rejects(
			() => buildChatBody.call(context({ prompt: 'x', options: { maxTokens } }), { body: {} }),
			/Invalid value for 'Max Tokens'/,
		);
	}
});

test('HTTP errors point at the failing item', async () => {
	const ctx = context({ source: 'key' }, { itemIndex: 3 });
	await assert.rejects(
		() => checkSpendResponse.call(ctx, [], { statusCode: 500, body: { error: 'boom' } }),
		(error) => error.context.itemIndex === 3,
	);
});

test('simplify flattens a chat completion', async () => {
	const body = {
		model: 'm',
		choices: [{ finish_reason: 'stop', message: { content: 'hi' } }],
		usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
	};
	const [item] = await simplifyChat.call(context({ simple: true }), [{ json: body }], ok(body));
	assert.deepEqual(item.json, {
		text: 'hi',
		finishReason: 'stop',
		model: 'm',
		promptTokens: 3,
		completionTokens: 1,
		totalTokens: 4,
	});
});

test('simplify handles empty choices and tool calls', async () => {
	const [empty] = await simplifyChat.call(context({ simple: true }), [], ok({ choices: [] }));
	assert.equal(empty.json.text, null);
	const calls = [{ id: 't1', type: 'function' }];
	const toolCall = {
		choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: calls } }],
	};
	const [tool] = await simplifyChat.call(context({ simple: true }), [], ok(toolCall));
	assert.deepEqual(tool.json.toolCalls, calls);
});

test('simplify off returns the raw items', async () => {
	const items = [{ json: { raw: true } }];
	assert.equal(await simplifyChat.call(context({ simple: false }), items, ok({})), items);
});

test('output items are paired with the input item', async () => {
	const out = await pairWithInput.call(context({}, { itemIndex: 2 }), [
		{ json: { id: 'a' } },
		{ json: { id: 'b' } },
	]);
	assert.deepEqual(
		out.map((i) => i.pairedItem),
		[{ item: 2 }, { item: 2 }],
	);
});

test('guarded hooks run in order and throw when On Error is stop', async () => {
	const calls = [];
	const record = (name) =>
		async function (items) {
			calls.push(name);
			return items;
		};
	await guarded(record('a'), record('b')).call(context({}), [], ok({}));
	assert.deepEqual(calls, ['a', 'b']);
	const hook = guarded(throwOnHttpError, expectArray('data'), listModels);
	const out = await hook.call(context({}), [], ok({ data: [{ id: 'a' }, { id: 'b' }] }));
	assert.deepEqual(
		out.map((i) => i.json.id),
		['a', 'b'],
	);
	await assert.rejects(
		() => hook.call(context({}), [], { statusCode: 401, body: { error: { message: 'bad key' } } }),
		/bad key/,
	);
});

test('guarded hooks return an error item when On Error is continue', async () => {
	const hook = guarded(throwOnHttpError);
	const response = { statusCode: 401, body: { error: { message: 'bad key' } } };
	const [item] = await hook.call(context({}, { continueOnFail: true }), [], response);
	assert.deepEqual(item.json, { error: 'bad key', message: 'bad key' });
});

test('guarded wraps unexpected errors with the item index', async () => {
	const failing = async () => {
		throw new Error('boom');
	};
	await assert.rejects(
		() => guarded(failing).call(context({}, { itemIndex: 4 }), [], ok({})),
		(error) => error.name === 'NodeOperationError' && error.context.itemIndex === 4,
	);
});
