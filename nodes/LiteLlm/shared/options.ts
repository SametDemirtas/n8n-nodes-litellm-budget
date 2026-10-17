import { NodeOperationError, type IExecuteSingleFunctions } from 'n8n-workflow';

const DECIMAL = /^\s*[-+]?(\d+(\.\d*)?|\.\d+)(e[-+]?\d+)?\s*$/i;

type NumberRange = { min: number; max: number; integer?: boolean };

/**
 * Reads a numeric option that may come from an expression. Blank means "not set" and returns
 * undefined; anything that is not a plain decimal number in range fails the item.
 */
export function numberOption(
	ctx: IExecuteSingleFunctions,
	label: string,
	raw: unknown,
	{ min, max, integer = false }: NumberRange,
): number | undefined {
	if (raw === undefined || raw === null || (typeof raw === 'string' && raw.trim() === '')) {
		return undefined;
	}
	const value = typeof raw === 'string' && DECIMAL.test(raw) ? Number(raw) : raw;
	if (
		typeof value !== 'number' ||
		!Number.isFinite(value) ||
		value < min ||
		value > max ||
		(integer && !Number.isInteger(value))
	) {
		throw new NodeOperationError(ctx.getNode(), `Invalid value for '${label}'`, {
			description: `Expected a ${integer ? 'whole number' : 'number'} from ${min} to ${max}, got ${JSON.stringify(raw)}.`,
			itemIndex: ctx.getItemIndex(),
		});
	}
	return value;
}
