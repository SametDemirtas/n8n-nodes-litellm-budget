import type {
	IExecuteSingleFunctions,
	IN8nHttpFullResponse,
	INodeExecutionData,
} from 'n8n-workflow';
import { readSpend, summarizeSpend } from '../../shared/budget';
import { getSource } from '../../shared/spend';

export async function toSpendItem(
	this: IExecuteSingleFunctions,
	_items: INodeExecutionData[],
	response: IN8nHttpFullResponse,
): Promise<INodeExecutionData[]> {
	const source = getSource(this);
	return [{ json: { source, ...summarizeSpend(readSpend(response.body, source)) } }];
}
