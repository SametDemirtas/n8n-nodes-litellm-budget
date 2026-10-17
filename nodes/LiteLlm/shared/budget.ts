export type SpendSource = 'key' | 'proxy';
export type BudgetStatus = 'ok' | 'warn' | 'over' | 'no_budget';

export type SpendReading = {
	recordFound: boolean;
	spend: number | null;
	maxBudget: number | null;
	budgetDuration: string | null;
	budgetResetAt: string | null;
};

type BudgetWindow = { budgetDuration: string | null; budgetResetAt: string | null };

export type SpendSummary = BudgetWindow &
	(
		| { spend: number; maxBudget: number; remaining: number; usedPercent: number }
		| { spend: number | null; maxBudget: null; remaining: null; usedPercent: null }
	);

export type BudgetRule = { warnAtPercent: number; safetyMargin: number; alertStep: number };

export const DEFAULT_BUDGET_RULE: BudgetRule = {
	warnAtPercent: 80,
	safetyMargin: 0,
	alertStep: 10,
};

export type BudgetDecision = {
	status: BudgetStatus;
	allowed: boolean;
	message: string;
} & SpendSummary & { lastStep: number | null };

type SpendFields = {
	spend?: unknown;
	max_budget?: unknown;
	budget_duration?: unknown;
	budget_reset_at?: unknown;
	litellm_budget_table?: SpendFields | null;
};

// Amounts are rounded to 8 decimals so float noise does not flip a comparison.
const roundMoney = (n: number) => (Math.abs(n) > 1e12 ? n : Math.round(n * 1e8) / 1e8);

const toNumber = (v: unknown): number | null => {
	if (typeof v === 'number') return Number.isFinite(v) ? v : null;
	if (typeof v === 'string' && v.trim() !== '') {
		const n = Number(v);
		return Number.isFinite(n) ? n : null;
	}
	return null;
};

const nonEmptyString = (v: unknown): string | null =>
	typeof v === 'string' && v !== '' ? v : null;

/** Formats dollars. Amounts from a cent up are cut, not rounded, to cents, so $99.996 never shows as $100.00. */
export function formatMoney(n: number): string {
	const a = Math.abs(n);
	let digits =
		a === 0 || a >= 0.01
			? (Math.floor(roundMoney(a * 100)) / 100).toFixed(2)
			: a.toFixed(8).replace(/0+$/, '');
	if (digits.endsWith('.')) digits = a > 0 ? '0.00000001' : '0.00';
	return `${n < 0 ? '-' : ''}$${digits}`;
}

export function spendRecord(body: unknown, source: SpendSource): SpendFields | null {
	if (typeof body !== 'object' || body === null) return null;
	const record = (body as Record<string, unknown>)[source === 'key' ? 'info' : 'user_info'];
	return typeof record === 'object' && record !== null ? (record as SpendFields) : null;
}

/**
 * Reads /key/info (`info`) or /user/info?user_id=litellm-proxy-budget (`user_info`).
 * A key linked to a budget tier has its limits in `litellm_budget_table`.
 * LiteLLM only enforces a proxy max_budget above 0, so 0 or less counts as no budget there.
 */
export function readSpend(body: unknown, source: SpendSource): SpendReading {
	const fields = spendRecord(body, source);
	if (!fields) {
		return {
			recordFound: false,
			spend: null,
			maxBudget: null,
			budgetDuration: null,
			budgetResetAt: null,
		};
	}
	const tier: SpendFields = (source === 'key' ? fields.litellm_budget_table : null) ?? {};
	let maxBudget = toNumber(fields.max_budget) ?? toNumber(tier.max_budget);
	if (source === 'proxy' && maxBudget !== null && maxBudget <= 0) maxBudget = null;
	return {
		recordFound: true,
		spend: toNumber(fields.spend),
		maxBudget,
		budgetDuration: nonEmptyString(fields.budget_duration) ?? nonEmptyString(tier.budget_duration),
		budgetResetAt: nonEmptyString(fields.budget_reset_at) ?? nonEmptyString(tier.budget_reset_at),
	};
}

export function summarizeSpend(reading: SpendReading): SpendSummary {
	const budgetWindow = {
		budgetDuration: reading.budgetDuration,
		budgetResetAt: reading.budgetResetAt,
	};
	const spend = reading.recordFound ? roundMoney(reading.spend ?? 0) : null;
	if (reading.maxBudget === null || spend === null) {
		return { spend, maxBudget: null, remaining: null, usedPercent: null, ...budgetWindow };
	}
	const maxBudget = roundMoney(reading.maxBudget);
	// A zero budget blocks everything, so it counts as fully used.
	const usedPercent = maxBudget > 0 ? roundMoney((spend / maxBudget) * 100) : 100;
	return {
		spend,
		maxBudget,
		remaining: roundMoney(maxBudget - spend),
		usedPercent,
		...budgetWindow,
	};
}

export function evaluateBudget(
	summary: SpendSummary,
	rule: BudgetRule,
	source: SpendSource,
): BudgetDecision {
	const lastStep =
		rule.alertStep > 0 && summary.spend !== null
			? roundMoney(Math.floor(summary.spend / rule.alertStep + 1e-9) * rule.alertStep)
			: null;

	if (summary.maxBudget === null) {
		let message: string;
		if (summary.spend === null) {
			message =
				'no_budget: LiteLLM does not track proxy-wide spend unless litellm_settings.max_budget is set.';
		} else {
			const scope = source === 'key' ? 'on this key' : 'for the whole proxy';
			message = `no_budget: spent ${formatMoney(summary.spend)}, no budget is set ${scope}.`;
		}
		return { status: 'no_budget', allowed: true, message, ...summary, lastStep };
	}

	let status: BudgetStatus = 'ok';
	if (summary.remaining <= rule.safetyMargin) status = 'over';
	else if (summary.usedPercent >= rule.warnAtPercent) status = 'warn';

	const shownPercent = (Math.floor(summary.usedPercent * 10) / 10).toFixed(1);
	let left =
		summary.remaining < 0
			? `${formatMoney(-summary.remaining)} over`
			: `${formatMoney(summary.remaining)} left`;
	if (status === 'over' && summary.remaining >= 0 && rule.safetyMargin > 0) {
		left += `, within the ${formatMoney(rule.safetyMargin)} safety margin`;
	}
	return {
		status,
		allowed: status !== 'over',
		message: `${status}: spent ${formatMoney(summary.spend)} of ${formatMoney(summary.maxBudget)} (${shownPercent}%), ${left}.`,
		...summary,
		lastStep,
	};
}
