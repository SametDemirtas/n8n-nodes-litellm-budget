import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LiteLlm } = require('../dist/nodes/LiteLlm/LiteLlm.node.js');
const { BASE_URL } = require('../dist/credentials/LiteLlmApi.credentials.js');
const { DEFAULT_BUDGET_RULE } = require('../dist/nodes/LiteLlm/shared/budget.js');
const { spendRequest } = require('../dist/nodes/LiteLlm/shared/spend.js');
const { pairWithInput } = require('../dist/nodes/LiteLlm/shared/items.js');

const { description } = new LiteLlm();
// n8n expressions are JavaScript inside ={{ }}; evaluate them with the variables they use.
const evaluate = (expression, variables) => {
	const body = expression.replace(/^=\{\{/, '').replace(/\}\}$/, '');
	return new Function(...Object.keys(variables), `return (${body});`)(...Object.values(variables));
};

test('base URL is normalised', () => {
	const cases = {
		'http://127.0.0.1:4000': 'http://127.0.0.1:4000',
		' https://llm.example.com/ ': 'https://llm.example.com',
		'https://llm.example.com/v1/': 'https://llm.example.com',
		'https://llm.example.com/V1': 'https://llm.example.com',
		'https://host/litellm': 'https://host/litellm',
		'127.0.0.1:4000': 'http://127.0.0.1:4000',
		'localhost:4000': 'http://localhost:4000',
		'llm.example.com': 'https://llm.example.com',
	};
	for (const [input, expected] of Object.entries(cases)) {
		assert.equal(evaluate(BASE_URL, { $credentials: { baseUrl: input } }), expected, input);
	}
	assert.equal(description.requestDefaults.baseURL, BASE_URL);
});

test('spend URL depends on the source', () => {
	assert.equal(evaluate(spendRequest.url, { $parameter: { source: 'key' } }), '/key/info');
	assert.equal(
		evaluate(spendRequest.url, { $parameter: { source: 'proxy' } }),
		'/user/info?user_id=litellm-proxy-budget',
	);
});

test('budget option defaults match the budget rule', () => {
	const options = description.properties.find(
		(p) => p.name === 'options' && p.displayOptions.show.resource[0] === 'budget',
	);
	const defaults = Object.fromEntries(options.options.map((o) => [o.name, o.default]));
	assert.deepEqual(defaults, DEFAULT_BUDGET_RULE);
});

test('every operation handles HTTP errors itself and pairs its output', () => {
	const operations = description.properties
		.filter((p) => p.name === 'operation')
		.flatMap((p) => p.options);
	assert.equal(operations.length, 4);
	for (const op of operations) {
		assert.ok(op.routing.request.url, op.value);
		assert.equal(op.routing.request.ignoreHttpStatusErrors, true, op.value);
		const hooks = op.routing.output.postReceive;
		assert.ok(
			hooks.every((hook) => typeof hook === 'function'),
			op.value,
		);
		assert.equal(hooks.at(-1), pairWithInput, op.value);
		for (const hook of op.routing.send?.preSend ?? []) assert.equal(typeof hook, 'function');
	}
});
