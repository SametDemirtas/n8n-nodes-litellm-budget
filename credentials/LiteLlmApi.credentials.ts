import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Trims the URL, adds a scheme when none is given (http:// only for loopback hosts, https:// otherwise)
 * and drops a trailing slash or /v1, because the spend routes have no /v1 alias.
 */
export const BASE_URL =
	'={{ (/^https?:\\/\\//i.test($credentials.baseUrl.trim()) ? "" : /^(localhost|127\\.|\\[::1\\])/i.test($credentials.baseUrl.trim()) ? "http://" : "https://") + $credentials.baseUrl.trim().replace(/\\/+$/, "").replace(/\\/v1$/i, "") }}';

export class LiteLlmApi implements ICredentialType {
	name = 'liteLlmApi';

	displayName = 'LiteLLM API';

	icon = 'file:../icons/litellm.svg' as const;

	documentationUrl = 'https://docs.litellm.ai/docs/proxy/virtual_keys';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			required: true,
			default: '',
			placeholder: 'http://127.0.0.1:4000',
			description: 'Root URL of your LiteLLM proxy. A trailing slash or /v1 is removed.',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			required: true,
			default: '',
			description: 'A LiteLLM virtual key, or the master key for proxy-wide spend',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '=Bearer {{$credentials.apiKey.trim()}}',
			},
		},
	};

	test: ICredentialTestRequest = {
		request: { baseURL: BASE_URL, url: '/models', method: 'GET' },
	};
}
