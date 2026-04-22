#!/usr/bin/env node
/**
 * Standalone Telegram smoke test.
 * Usage: node src/test-telegram.js
 * Sends a test message to TELEGRAM_STAGING_CHAT_ID.
 */
import 'dotenv/config';
import { TelegramPublisher } from './publishers/telegram.js';

const tg = new TelegramPublisher({ botToken: process.env.TELEGRAM_BOT_TOKEN });
const result = await tg.sendMessage(
  process.env.TELEGRAM_STAGING_CHAT_ID,
  '✅ <b>Smoke test from povguy-publisher</b>\n\nIf you see this, the bot can post to staging.'
);
console.log('OK — message_id:', result.message_id);
