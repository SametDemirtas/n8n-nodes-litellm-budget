import type {
	DeclarativeRestApiSettings,
	IExecuteSingleFunctions,
	IN8nHttpFullResponse,
	INodeExecutionData,
	INodeProperties,
} from 'n8n-workflow';
import { spendRecord, type SpendSource } from './budget';
import { liteLlmMessage, toNodeApiError, unexpectedResponse } from './errors';

export const spendSourceField = (resource: string): INodeProperties => ({
	displayName: 'Source',
	name: 'source',
	type: 'options',
	noDataExpression: true,
	displayOptions: { show: { resource: [resource] } },
	options: [
		{
			name: 'Current Key',
			value: 'key',
			description:
				"Spend and budget of the virtual key in the credential, including a budget tier linked by 'budget_id'. Team, user, per-model, multi-window and proxy-wide budgets are not included. The master key has no key record.",
		},
		{
			name: 'Whole Proxy',
			value: 'proxy',
			description:
				"Proxy-wide budget from 'litellm_settings.max_budget'. Needs an admin key such as the master key.",
		},
	],
	default: 'key',
});

export const spendRequest: DeclarativeRestApiSettings.HttpRequestOptions = {
	method: 'GET',
	url: '={{ $parameter.source === "proxy" ? "/user/info?user_id=litellm-proxy-budget" : "/key/info" }}',
	ignoreHttpStatusErrors: true,
};

export const getSource = (ctx: IExecuteSingleFunctions) =>
	ctx.getNodeParameter('source', 'key') as SpendSource;

const spendErrorHint = (source: SpendSource, status: number, message: string) => {
	if (status === 401) {
		return "LiteLLM rejected the key (invalid, expired or blocked). Check 'API Key' in the credential.";
	}
	if (source === 'proxy' && status === 403) {
		return "'Whole Proxy' needs an admin key. Use the master key, or set 'Source' to 'Current Key'.";
	}
	if (source === 'key' && status === 404 && /key not found/i.test(message)) {
		return "The master key has no key record. Use a virtual key, or set 'Source' to 'Whole Proxy'.";
	}
	return undefined;
};

/**
 * Validates the spend response. LiteLLM only creates the proxy budget record when
 * litellm_settings.max_budget is set, so a 404 for that record means no proxy budget.
 */
export async function checkSpendResponse(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const source = getSource(this);
	const message = liteLlmMessage(response.body) ?? '';

	if (response.statusCode >= 400) {
		if (
			source === 'proxy' &&
			response.statusCode === 404 &&
			/litellm-proxy-budget.*not found/i.test(message)
		) {
			return items;
		}
		throw toNodeApiError(this, response, spendErrorHint(source, response.statusCode, message));
	}
	if (!spendRecord(response.body, source)) throw unexpectedResponse(this, response);
	return items;
}
