import { NodeConnectionTypes, type INodeType, type INodeTypeDescription } from 'n8n-workflow';
import { BASE_URL } from '../../credentials/LiteLlmApi.credentials';
import { budgetDescription } from './resources/budget';
import { chatDescription } from './resources/chat';
import { modelDescription } from './resources/model';
import { spendDescription } from './resources/spend';

export class LiteLlm implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'LiteLLM',
		name: 'liteLlm',
		icon: { light: 'file:../../icons/litellm.svg', dark: 'file:../../icons/litellm.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Use the LiteLLM proxy API: chat completions, models, spend and budget checks',
		defaults: { name: 'LiteLLM' },
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'liteLlmApi', required: true }],
		requestDefaults: {
			baseURL: BASE_URL,
			headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
		},
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Budget', value: 'budget' },
					{ name: 'Chat', value: 'chat' },
					{ name: 'Model', value: 'model' },
					{ name: 'Spend', value: 'spend' },
				],
				default: 'chat',
			},
			...budgetDescription,
			...chatDescription,
			...modelDescription,
			...spendDescription,
		],
	};
}
