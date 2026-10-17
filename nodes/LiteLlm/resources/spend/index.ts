import type { INodeProperties } from 'n8n-workflow';
import { guarded } from '../../shared/errors';
import { pairWithInput } from '../../shared/items';
import { checkSpendResponse, spendRequest, spendSourceField } from '../../shared/spend';
import { toSpendItem } from './hooks';

export const spendDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['spend'] } },
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Get spend',
				description: 'Retrieve spend, budget, remaining budget and percentage used',
				routing: {
					request: spendRequest,
					output: { postReceive: [guarded(checkSpendResponse, toSpendItem), pairWithInput] },
				},
			},
		],
		default: 'get',
	},
	spendSourceField('spend'),
];
