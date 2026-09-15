export type ReasoningProvider = {
  name: 'hermes' | 'together';
  baseUrl: string;
  apiKey: string;
  model: string;
};

export function getReasoningProviders(): ReasoningProvider[] {
  const providers: ReasoningProvider[] = [];

  if (process.env.HERMES_BASE_URL) {
    providers.push({
      name: 'hermes',
      baseUrl: process.env.HERMES_BASE_URL.replace(/\/$/, ''),
      apiKey: process.env.HERMES_API_KEY || '',
      model: process.env.HERMES_MODEL || 'hermes-agent',
    });
  }

  if (process.env.TOGETHER_API_KEY) {
    providers.push({
      name: 'together',
      baseUrl: 'https://api.together.xyz/v1',
      apiKey: process.env.TOGETHER_API_KEY,
      model: process.env.TOGETHER_MODEL || 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    });
  }

  return providers;
}

export function getReasoningProvider(): ReasoningProvider | null {
  return getReasoningProviders()[0] || null;
}
