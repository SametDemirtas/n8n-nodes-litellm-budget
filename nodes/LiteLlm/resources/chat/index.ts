import type { INodeProperties } from 'n8n-workflow';
import { expectArray, guarded, throwOnHttpError } from '../../shared/errors';
import { pairWithInput } from '../../shared/items';
import { buildChatBody, simplifyChat } from './hooks';

const show = { resource: ['chat'], operation: ['complete'] };

export const chatDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: ['chat'] } },
		options: [
			{
				name: 'Message a Model',
				value: 'complete',
				action: 'Message a model',
				description: 'Send a chat message to a model through the proxy',
				routing: {
					send: { preSend: [buildChatBody] },
					request: {
						method: 'POST',
						url: '/chat/completions',
						ignoreHttpStatusErrors: true,
						body: { model: '={{$parameter.model}}' },
					},
					output: {
						postReceive: [
							guarded(throwOnHttpError, expectArray('choices'), simplifyChat),
							pairWithInput,
						],
					},
				},
			},
		],
		default: 'complete',
	},
	{
		displayName: 'Model Name or ID',
		name: 'model',
		type: 'options',
		required: true,
		default: '',
		description:
			'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		typeOptions: {
			loadOptions: {
				routing: {
					request: { method: 'GET', url: '/models' },
					output: {
						postReceive: [
							{ type: 'rootProperty', properties: { property: 'data' } },
							{
								type: 'setKeyValue',
								properties: { name: '={{$responseItem.id}}', value: '={{$responseItem.id}}' },
							},
							{ type: 'sort', properties: { key: 'name' } },
						],
					},
				},
			},
		},
		displayOptions: { show },
	},
	{
		displayName: 'Prompt',
		name: 'prompt',
		type: 'string',
		typeOptions: { rows: 5 },
		required: true,
		default: '',
		placeholder: 'e.g. Summarize this text in two sentences',
		description: 'The user message sent to the model',
		displayOptions: { show },
	},
	{
		displayName: 'System Prompt',
		name: 'systemPrompt',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		placeholder: 'e.g. Answer in plain English, under 100 words',
		description: 'Instructions sent before the prompt, such as tone or output format',
		displayOptions: { show },
	},
	{
		displayName: 'Simplify',
		name: 'simple',
		type: 'boolean',
		default: true,
		description: 'Whether to return a simplified version of the response instead of the raw data',
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
				displayName: 'Max Tokens',
				name: 'maxTokens',
				type: 'number',
				typeOptions: { minValue: 1, numberPrecision: 0 },
				default: 1024,
				description: 'Upper limit for the number of tokens in the answer',
			},
			{
				displayName: 'Temperature',
				name: 'temperature',
				type: 'number',
				typeOptions: { minValue: 0, maxValue: 2, numberPrecision: 2 },
				default: 1,
				description:
					'Higher values make the answer more varied, lower values more focused. Most providers default to 1.',
			},
		],
	},
];
