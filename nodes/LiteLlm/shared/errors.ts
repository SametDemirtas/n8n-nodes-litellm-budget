import {
	NodeApiError,
	NodeOperationError,
	type IDataObject,
	type IExecuteSingleFunctions,
	type IN8nHttpFullResponse,
	type INodeExecutionData,
	type JsonObject,
} from 'n8n-workflow';

type ErrorBody = { error?: { message?: unknown } | string; detail?: unknown };

export function liteLlmMessage(body: unknown): string | undefined {
	const b = (typeof body === 'object' && body !== null ? body : {}) as ErrorBody;
	if (typeof b.error === 'string') return b.error;
	if (b.error && typeof b.error.message === 'string') return b.error.message;
	if (typeof b.detail === 'string') return b.detail;
	if (Array.isArray(b.detail)) {
		const first = b.detail[0] as { msg?: unknown } | undefined;
		if (typeof first?.msg === 'string') return first.msg;
	}
	if (typeof b.detail === 'object' && b.detail !== null) {
		const d = b.detail as { error?: unknown; message?: unknown };
		if (typeof d.error === 'string') return d.error;
		if (typeof d.message === 'string') return d.message;
	}
	return undefined;
}

// LiteLLM auth errors quote the masked key and its hash; keep them out of execution data.
const redact = (text: string) =>
	text.replace(/sk-[\w.*-]+/g, 'sk-***').replace(/(Key Hash \(Token\)\s*=\s*)\w+/gi, '$1***');

const asJson = (body: unknown): JsonObject => {
	if (typeof body !== 'object' || body === null) return { body: redact(String(body ?? '')) };
	return JSON.parse(redact(JSON.stringify(body))) as JsonObject;
};

export function toNodeApiError(
	ctx: IExecuteSingleFunctions,
	response: IN8nHttpFullResponse,
	description?: string,
): NodeApiError {
	const status = String(response.statusCode);
	const message = liteLlmMessage(response.body);
	return new NodeApiError(ctx.getNode(), asJson(response.body), {
		message: message ? redact(message) : `LiteLLM returned HTTP ${status}`,
		description,
		httpCode: status,
		itemIndex: ctx.getItemIndex(),
	});
}

export function unexpectedResponse(
	ctx: IExecuteSingleFunctions,
	response: IN8nHttpFullResponse,
): NodeApiError {
	return new NodeApiError(ctx.getNode(), asJson(response.body), {
		message: 'Unexpected response from LiteLLM',
		description: "Check that 'Base URL' points at the LiteLLM proxy itself.",
		itemIndex: ctx.getItemIndex(),
	});
}

/**
 * With 'On Error' set to continue, n8n sends items whose json has only `error`, `message` and
 * `details` to the error output and keeps the link to the input item.
 */
export const errorItem = (
	error: string,
	message: string,
	details?: IDataObject,
): INodeExecutionData => ({ json: { error, message, ...(details ? { details } : {}) } });

/** Requests run with ignoreHttpStatusErrors, so errors are raised here with LiteLLM's own message. */
export async function throwOnHttpError(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	if (response.statusCode >= 400) throw toNodeApiError(this, response);
	return items;
}

type PostReceiveHook = (
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
) => Promise<INodeExecutionData[]>;

/** Runs hooks in order and turns a failure into an error item when 'On Error' is set to continue. */
export const guarded = (...hooks: PostReceiveHook[]): PostReceiveHook =>
	async function (this: IExecuteSingleFunctions, items, response) {
		try {
			let output = items;
			for (const hook of hooks) output = await hook.call(this, output, response);
			return output;
		} catch (caught) {
			const error =
				caught instanceof NodeApiError || caught instanceof NodeOperationError
					? caught
					: new NodeOperationError(this.getNode(), caught as Error, {
							itemIndex: this.getItemIndex(),
						});
			if (!this.continueOnFail()) throw error;
			return [errorItem(error.message, error.description ?? error.message)];
		}
	};

/** Builds a postReceive hook that rejects 2xx bodies that are not the expected LiteLLM shape. */
export const expectArray = (property: string) =>
	async function (
		this: IExecuteSingleFunctions,
		items: INodeExecutionData[],
		response: IN8nHttpFullResponse,
	): Promise<INodeExecutionData[]> {
		const body = response.body as Record<string, unknown> | null;
		if (typeof body !== 'object' || body === null || !Array.isArray(body[property])) {
			throw unexpectedResponse(this, response);
		}
		return items;
	};
