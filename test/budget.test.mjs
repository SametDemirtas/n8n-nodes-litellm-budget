import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
	evaluateBudget,
	formatMoney,
	readSpend,
	summarizeSpend,
	DEFAULT_BUDGET_RULE,
} = require('../dist/nodes/LiteLlm/shared/budget.js');

const reading = (spend, maxBudget) => ({
	recordFound: true,
	spend,
	maxBudget,
	budgetDuration: null,
	budgetResetAt: null,
});
const check = (spend, maxBudget, overrides = {}, source = 'key') =>
	evaluateBudget(
		summarizeSpend(reading(spend, maxBudget)),
		{ ...DEFAULT_BUDGET_RULE, ...overrides },
		source,
	);

test('ok below the warn line', () => {
	const r = check(12.5, 60);
	assert.equal(r.status, 'ok');
	assert.equal(r.allowed, true);
	assert.equal(r.remaining, 47.5);
	assert.equal(r.lastStep, 10);
	assert.equal(r.message, 'ok: spent $12.50 of $60.00 (20.8%), $47.50 left.');
});

test('warn starts exactly at the warn line', () => {
	assert.equal(check(47.99, 60).status, 'ok');
	const r = check(48, 60);
	assert.equal(r.status, 'warn');
	assert.equal(r.usedPercent, 80);
});

test('over when nothing is left', () => {
	const r = check(60, 60);
	assert.equal(r.status, 'over');
	assert.equal(r.allowed, false);
});

test('safety margin: over when remaining equals the margin', () => {
	const r = check(55, 60, { safetyMargin: 5 });
	assert.equal(r.status, 'over');
	assert.equal(
		r.message,
		'over: spent $55.00 of $60.00 (91.6%), $5.00 left, within the $5.00 safety margin.',
	);
});

test('over wins over warn', () => {
	assert.equal(check(58, 60, { safetyMargin: 5 }).status, 'over');
});

test('overspend says how much is over', () => {
	assert.equal(check(72, 60).message, 'over: spent $72.00 of $60.00 (120.0%), $12.00 over.');
});

test('a key budget of 0 blocks everything', () => {
	const r = check(0, 0);
	assert.equal(r.status, 'over');
	assert.equal(r.usedPercent, 100);
});

test('spend of null on a fresh key counts as zero', () => {
	const r = check(null, 60);
	assert.equal(r.spend, 0);
	assert.equal(r.status, 'ok');
	assert.equal(r.lastStep, 0);
});

test('no budget on a key or proxy is allowed', () => {
	const key = check(3, null, {}, 'key');
	assert.equal(key.status, 'no_budget');
	assert.equal(key.allowed, true);
	assert.equal(key.message, 'no_budget: spent $3.00, no budget is set on this key.');
	assert.equal(
		check(3, null, {}, 'proxy').message,
		'no_budget: spent $3.00, no budget is set for the whole proxy.',
	);
});

test('missing proxy budget record has no spend figure', () => {
	const r = evaluateBudget(
		summarizeSpend(readSpend({ error: {} }, 'proxy')),
		DEFAULT_BUDGET_RULE,
		'proxy',
	);
	assert.equal(r.status, 'no_budget');
	assert.equal(r.spend, null);
	assert.equal(r.lastStep, null);
	assert.match(r.message, /does not track proxy-wide spend/);
});

test('alert steps with decimal amounts', () => {
	assert.equal(check(0.3, 60, { alertStep: 0.1 }).lastStep, 0.3);
	assert.equal(check(2.1, 60, { alertStep: 0.7 }).lastStep, 2.1);
	assert.equal(check(33, 60, { alertStep: 0 }).lastStep, null);
});

test('percentage is truncated, so 99.96% shows as 99.9%', () => {
	assert.match(check(59.976, 60).message, /\(99\.9%\)/);
});

test('decision fields come first in the output', () => {
	assert.deepEqual(Object.keys(check(1, 60)).slice(0, 3), ['status', 'allowed', 'message']);
});

test('money formatting', () => {
	assert.equal(formatMoney(0), '$0.00');
	assert.equal(formatMoney(0.3), '$0.30');
	assert.equal(formatMoney(0.9996), '$0.99');
	assert.equal(formatMoney(99.996), '$99.99');
	assert.equal(formatMoney(0.29), '$0.29');
	assert.equal(formatMoney(1234.5), '$1234.50');
	assert.equal(formatMoney(0.0000135), '$0.0000135');
	assert.equal(formatMoney(1e-7), '$0.0000001');
	assert.equal(formatMoney(1e-9), '$0.00000001');
	assert.equal(formatMoney(-0.0000035), '-$0.0000035');
});

test('sub-cent spend on a tiny budget', () => {
	const r = check(0.0000135, 0.00001, { alertStep: 0 });
	assert.equal(r.spend, 0.0000135);
	assert.ok(r.remaining < 0);
	assert.equal(r.status, 'over');
});

test('spend summary carries no decision fields', () => {
	const s = summarizeSpend(reading(12.5, 60));
	assert.equal(s.remaining, 47.5);
	assert.ok(Math.abs(s.usedPercent - 125 / 6) < 1e-6);
	assert.equal('status' in s, false);
});

test('reads /key/info', () => {
	const body = {
		key: 'x',
		info: {
			spend: 1.2,
			max_budget: 5,
			budget_duration: '30d',
			budget_reset_at: '2026-11-01T00:00:00Z',
		},
	};
	assert.deepEqual(readSpend(body, 'key'), {
		recordFound: true,
		spend: 1.2,
		maxBudget: 5,
		budgetDuration: '30d',
		budgetResetAt: '2026-11-01T00:00:00Z',
	});
});

test('reads the budget tier of a key linked by budget_id', () => {
	const body = {
		info: {
			spend: 2,
			max_budget: null,
			litellm_budget_table: {
				max_budget: 5,
				budget_duration: '7d',
				budget_reset_at: '2026-10-20T00:00:00Z',
			},
		},
	};
	const r = readSpend(body, 'key');
	assert.equal(r.maxBudget, 5);
	assert.equal(r.budgetDuration, '7d');
	assert.equal(r.budgetResetAt, '2026-10-20T00:00:00Z');
});

test('reads the proxy budget record from /user/info', () => {
	const body = {
		user_id: 'litellm-proxy-budget',
		user_info: { spend: 0.0003, max_budget: 60, budget_duration: '30d', budget_reset_at: null },
	};
	assert.deepEqual(readSpend(body, 'proxy'), {
		recordFound: true,
		spend: 0.0003,
		maxBudget: 60,
		budgetDuration: '30d',
		budgetResetAt: null,
	});
});

test('proxy max_budget of 0 means no budget, key max_budget of 0 means blocked', () => {
	assert.equal(readSpend({ user_info: { spend: 1, max_budget: 0 } }, 'proxy').maxBudget, null);
	assert.equal(readSpend({ info: { spend: 1, max_budget: 0 } }, 'key').maxBudget, 0);
});

test('only numbers and numeric strings count as amounts', () => {
	assert.equal(readSpend({ info: { spend: '1.5', max_budget: '5' } }, 'key').spend, 1.5);
	for (const bad of [' ', 'abc', true, [100], {}]) {
		assert.equal(readSpend({ info: { spend: 1, max_budget: bad } }, 'key').maxBudget, null);
	}
	assert.equal(readSpend(null, 'key').recordFound, false);
});
