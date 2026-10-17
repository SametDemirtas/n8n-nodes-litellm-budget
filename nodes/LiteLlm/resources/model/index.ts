import type { INodeProperties } from 'n8n-workflow';
import { expectArray, guarded, throwOnHttpError } from '../../shared/errors';
import { pairWithInput } from '../../shared/items';
import { listModels } from './hooks';

const show = { resource: ['model'], operation: ['getAll'] };

export const modelDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['model'] } },
		options: [
			{
				name: 'Get Many',
				value: 'getAll',
				action: 'Get many models',
				description: 'Retrieve a list of models this key can call',
				routing: {
					request: { method: 'GET', url: '/models', ignoreHttpStatusErrors: true },
					output: {
						postReceive: [
							guarded(throwOnHttpError, expectArray('data'), listModels),
							pairWithInput,
						],
					},
				},
			},
		],
		default: 'getAll',
	},
	{
		displayName: 'Return All',
		name: 'returnAll',
		type: 'boolean',
		default: false,
		description: 'Whether to return all results or only up to a given limit',
		displayOptions: { show },
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		typeOptions: { minValue: 1 },
		default: 50,
		description: 'Max number of results to return',
		displayOptions: { show: { ...show, returnAll: [false] } },
		routing: { output: { maxResults: '={{$value}}' } },
	},
];
