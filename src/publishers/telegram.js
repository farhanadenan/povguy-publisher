/**
 * Telegram publisher — sendMediaGroup for carousel albums.
 *
 * Telegram album rules:
 *   - 2 to 10 photos per album
 *   - Caption goes on the FIRST photo only
 *   - Max caption: 1024 chars (HTML/Markdown allowed)
 *   - File size limit: 10MB per photo via multipart, 50MB via URL
 */

import fs from 'node:fs';
import path from 'node:path';
import FormData from 'form-data';
import fetch from 'node-fetch';

const TG_API = 'https://api.telegram.org';

export class TelegramPublisher {
  constructor({ botToken }) {
    if (!botToken) throw new Error('TELEGRAM_BOT_TOKEN is required');
    this.botToken = botToken;
    this.base = `${TG_API}/bot${botToken}`;
  }

  /**
   * Send a carousel album to a channel.
   * @param {string|number} chatId - numeric ID (e.g. -1003773691418) or @username
   * @param {string[]} imagePaths - absolute paths to PNG/JPG slides (max 10)
   * @param {string} caption - HTML-formatted caption for first slide
   * @returns {Promise<{ok: boolean, message_ids?: number[], drop_id?: string}>}
   */
  async sendCarousel(chatId, imagePaths, caption) {
    if (imagePaths.length < 2 || imagePaths.length > 10) {
      throw new Error(`Telegram albums need 2–10 photos. Got ${imagePaths.length}.`);
    }
    if (caption && caption.length > 1024) {
      console.warn(`[telegram] caption ${caption.length}ch > 1024 limit — truncating`);
      caption = caption.slice(0, 1020) + '...';
    }

    const form = new FormData();
    form.append('chat_id', String(chatId));

    const media = imagePaths.map((p, i) => {
      const attachKey = `photo${i}`;
      form.append(attachKey, fs.createReadStream(p), path.basename(p));
      return {
        type: 'photo',
        media: `attach://${attachKey}`,
        ...(i === 0 && caption ? { caption, parse_mode: 'HTML' } : {})
      };
    });
    form.append('media', JSON.stringify(media));

    const res = await fetch(`${this.base}/sendMediaGroup`, {
      method: 'POST',
      body: form,
      headers: form.getHeaders()
    });
    const data = await res.json();
    if (!data.ok) {
      throw new Error(`[telegram] sendMediaGroup failed: ${JSON.stringify(data)}`);
    }
    return {
      ok: true,
      message_ids: data.result.map(m => m.message_id),
      first_message_id: data.result[0].message_id
    };
  }

  /**
   * Send a plain text message (used for kill-switch hints, error notifications).
   */
  async sendMessage(chatId, text, opts = {}) {
    const res = await fetch(`${this.base}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        ...opts
      })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(`[telegram] sendMessage failed: ${JSON.stringify(data)}`);
    return data.result;
  }

  /**
   * Check if a kill marker reply exists for a given preview message.
   * Returns true if any reply contains "KILL" (case-insensitive).
   */
  async wasKilled(chatId, previewMessageId) {
    const res = await fetch(
      `${this.base}/getUpdates?offset=-100&allowed_updates=["message","channel_post"]`
    );
    const data = await res.json();
    if (!data.ok) return false;
    return data.result.some(u => {
      const msg = u.channel_post || u.message;
      if (!msg) return false;
      if (msg.chat?.id !== Number(chatId)) return false;
      if (msg.reply_to_message?.message_id !== previewMessageId) return false;
      return /\bKILL\b/i.test(msg.text || '');
    });
  }
}
