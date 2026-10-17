import type { INodeProperties } from 'n8n-workflow';
import { guarded } from '../../shared/errors';
import { pairWithInput } from '../../shared/items';
import { checkSpendResponse, spendRequest, spendSourceField } from '../../shared/spend';
import { toBudgetDecision } from './hooks';

const show = { resource: ['budget'], operation: ['check'] };

export const budgetDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['budget'] } },
		options: [
			{
				name: 'Check',
				value: 'check',
				action: 'Check budget',
				description:
					"Return 'ok', 'warn', 'over' or 'no_budget' from current spend, and optionally fail when over budget",
				routing: {
					request: spendRequest,
					output: { postReceive: [guarded(checkSpendResponse, toBudgetDecision), pairWithInput] },
				},
			},
		],
		default: 'check',
	},
	spendSourceField('budget'),
	{
		displayName: 'When Over Budget',
		name: 'onOver',
		type: 'options',
		options: [
			{
				name: 'Fail Node',
				value: 'stop',
				description:
					"Fail this node so the next nodes do not run. With 'On Error' set to 'Continue (using error output)', the item goes to the error output instead.",
			},
			{
				name: 'Return Status',
				value: 'output',
				description:
					"Output the decision with 'allowed' set to false and let an IF node decide. Use this when the node runs as an AI agent tool.",
			},
		],
		default: 'output',
		displayOptions: { show },
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		displayOptions: { show },
		options: [
			{
				displayName: 'Alert Step ($)',
				name: 'alertStep',
				type: 'number',
				typeOptions: { minValue: 0, numberPrecision: 2 },
				default: 10,
				description:
					"Outputs 'lastStep', the highest multiple of this amount already spent (e.g. 10, 20, 30), so a workflow can alert once per step. 0 turns it off.",
			},
			{
				displayName: 'Safety Margin ($)',
				name: 'safetyMargin',
				type: 'number',
				typeOptions: { minValue: 0, numberPrecision: 2 },
				default: 0,
				description:
					"Status becomes 'over' once the remaining budget is at or below this amount. LiteLLM writes spend to its database in batches about every 10 to 15 seconds, so keep it above what your workflows spend in that time.",
			},
			{
				displayName: 'Warn At (% of Budget)',
				name: 'warnAtPercent',
				type: 'number',
				typeOptions: { minValue: 1, maxValue: 100 },
				default: 80,
				description: "Status becomes 'warn' once this share of the budget is used",
			},
		],
	},
];
