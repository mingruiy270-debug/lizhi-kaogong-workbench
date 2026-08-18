import type { AiConfigView, AppSettings, IntegrationConfig } from './contracts'

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'dark',
  dailyTarget: 30,
  defaultPracticeCount: 10,
  defaultExamMinutes: 120,
  reduceMotion: false,
  autoBackup: true,
  backupRetention: 12
}

export const DEFAULT_AI_CONFIG: AiConfigView = {
  provider: 'deepseek',
  protocol: 'openai-chat',
  baseUrl: 'https://api.deepseek.com',
  model: 'deepseek-v4-flash',
  temperature: 0.3,
  maxTokens: 4096,
  hasApiKey: false,
  verified: false
}

export const DEFAULT_INTEGRATIONS: IntegrationConfig = {
  obsidianVaultPath: '',
  obsidianExecutable: ''
}

export const REVIEW_WRONG_DELAY_DAYS = 1
export const REVIEW_CORRECT_DELAY_DAYS = 3
export const REVIEW_MASTERED_STREAK = 2
