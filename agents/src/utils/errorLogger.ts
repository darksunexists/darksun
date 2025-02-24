import { elizaLogger } from '@elizaos/core';

interface TelegramConfig {
  botToken: string;
  chatId: string;
}

/**
 * Utility class for logging errors to Telegram (and console).
 */
export class ErrorLogger {
  private static telegramConfig?: TelegramConfig;

  static initialize(config: TelegramConfig) {
    this.telegramConfig = config;
  }

  static async logError(error: Error, context: string = ''): Promise<void> {
    const errorMessage = `🚨 Error: ${error.message}\nContext: ${context}`;
    elizaLogger.error(errorMessage);
    if (this.telegramConfig) {
      await this.sendTelegramMessage(errorMessage);
    }
  }

  private static async sendTelegramMessage(message: string) {
    if (!this.telegramConfig) return;
    const { botToken, chatId } = this.telegramConfig;
    try {
      const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: message }),
      });
    } catch (err) {
      elizaLogger.error('Failed to send Telegram error message:', err);
    }
  }
}
