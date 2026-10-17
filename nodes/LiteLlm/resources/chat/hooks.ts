import {
	NodeOperationError,
	type IDataObject,
	type IExecuteSingleFunctions,
	type IHttpRequestOptions,
	type IN8nHttpFullResponse,
	type INodeExecutionData,
} from 'n8n-workflow';
import { numberOption } from '../../shared/options';

type ChatCompletion = {
	model?: string;
	choices?: Array<{
		finish_reason?: string | null;
		message?: { content?: string | null; tool_calls?: unknown };
	}>;
	usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

const asText = (value: unknown): string => {
	if (value === null || value === undefined) return '';
	if (typeof value === 'string') return value;
	if (typeof value === 'number' || typeof value === 'boolean') return String(value);
	return JSON.stringify(value);
};

/** Builds messages and optional settings per item, after n8n has resolved the expressions. */
export async function buildChatBody(
	this: IExecuteSingleFunctions,
	requestOptions: IHttpRequestOptions,
): Promise<IHttpRequestOptions> {
	const prompt = asText(this.getNodeParameter('prompt', ''));
	if (prompt.trim() === '') {
		throw new NodeOperationError(this.getNode(), 'Prompt is empty', {
			description: "The 'Prompt' expression resolved to an empty value for this item.",
			itemIndex: this.getItemIndex(),
		});
	}
	const systemPrompt = asText(this.getNodeParameter('systemPrompt', ''));
	const body = (requestOptions.body ?? {}) as IDataObject;
	body.messages = [
		...(systemPrompt.trim() ? [{ role: 'system', content: systemPrompt }] : []),
		{ role: 'user', content: prompt },
	];

	const options = this.getNodeParameter('options', {}) as IDataObject;
	const temperature = numberOption(this, 'Temperature', options.temperature, { min: 0, max: 2 });
	const maxTokens = numberOption(this, 'Max Tokens', options.maxTokens, {
		min: 1,
		max: Number.MAX_SAFE_INTEGER,
		integer: true,
	});
	if (temperature !== undefined) body.temperature = temperature;
	if (maxTokens !== undefined) body.max_tokens = maxTokens;

	requestOptions.body = body;
	return requestOptions;
}

export async function simplifyChat(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	if (!this.getNodeParameter('simple', true)) return items;
	const body = (response.body ?? {}) as ChatCompletion;
	const choice = body.choices?.[0];
	return [
		{
			json: {
				text: choice?.message?.content ?? null,
				finishReason: choice?.finish_reason ?? null,
				...(choice?.message?.tool_calls
					? { toolCalls: choice.message.tool_calls as IDataObject[] }
					: {}),
				model: body.model ?? null,
				promptTokens: body.usage?.prompt_tokens ?? null,
				completionTokens: body.usage?.completion_tokens ?? null,
				totalTokens: body.usage?.total_tokens ?? null,
			},
		},
	];
}
