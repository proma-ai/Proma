export function getAgentSdkMaxOutputTokens(modelId: string | undefined): string | undefined {
  return modelId?.toLowerCase().includes('claude') ? '64000' : undefined
}
