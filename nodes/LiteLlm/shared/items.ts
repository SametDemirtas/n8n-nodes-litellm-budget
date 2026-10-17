import type { IExecuteSingleFunctions, INodeExecutionData } from 'n8n-workflow';

/** n8n only pairs output to input on its own when the counts match, which error outputs and lists break. */
export async function pairWithInput(
	this: IExecuteSingleFunctions,
	items: INodeExecutionData[],
): Promise<INodeExecutionData[]> {
	const item = this.getItemIndex();
	return items.map((entry) => ({ ...entry, pairedItem: { item } }));
}
