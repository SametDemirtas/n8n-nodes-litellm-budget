import {
	NodeOperationError,
	type IDataObject,
	type IExecuteSingleFunctions,
	type IN8nHttpFullResponse,
	type INodeExecutionData,
} from 'n8n-workflow';
import {
	DEFAULT_BUDGET_RULE,
	evaluateBudget,
	readSpend,
	summarizeSpend,
	type BudgetRule,
} from '../../shared/budget';
import { errorItem } from '../../shared/errors';
import { numberOption } from '../../shared/options';
import { getSource } from '../../shared/spend';

const readRule = (ctx: IExecuteSingleFunctions): BudgetRule => {
	const options = ctx.getNodeParameter('options', {}) as IDataObject;
	const read = (name: keyof BudgetRule, label: string, min: number, max: number) =>
		numberOption(ctx, label, options[name], { min, max }) ?? DEFAULT_BUDGET_RULE[name];
	return {
		warnAtPercent: read('warnAtPercent', 'Warn At (% of Budget)', 1, 100),
		safetyMargin: read('safetyMargin', 'Safety Margin ($)', 0, Number.MAX_SAFE_INTEGER),
		alertStep: read('alertStep', 'Alert Step ($)', 0, Number.MAX_SAFE_INTEGER),
	};
};

export async function toBudgetDecision(
	this: IExecuteSingleFunctions,
	_items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const source = getSource(this);
	const decision = evaluateBudget(
		summarizeSpend(readSpend(response.body, source)),
		readRule(this),
		source,
	);

	if (decision.allowed || this.getNodeParameter('onOver', 'output') !== 'stop') {
		return [{ json: { source, ...decision } }];
	}

	const title = 'LiteLLM budget limit reached';
	const advice =
		decision.remaining !== null && decision.remaining > 0
			? "Raise the budget in LiteLLM or lower 'Safety Margin'."
			: 'Raise the budget in LiteLLM.';
	if (this.continueOnFail()) {
		return [errorItem(title, `${decision.message} ${advice}`, { source, ...decision })];
	}
	throw new NodeOperationError(this.getNode(), title, {
		description: `${decision.message} ${advice}`,
		itemIndex: this.getItemIndex(),
	});
}
