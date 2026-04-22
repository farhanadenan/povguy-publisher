/**
 * Facebook Page publisher — multi-photo post via Graph API.
 *
 * Approach (works without media_fbid juggling):
 *   1. Upload each photo to /{page-id}/photos with published=false → returns photo IDs
 *   2. Create a feed post with attached_media[] referencing those photo IDs + caption
 *
 * Required scopes: pages_manage_posts, pages_read_engagement
 *
 * Status: scaffold only. Needs META_PAGE_ACCESS_TOKEN + META_PAGE_ID before activating.
 */

import fs from 'node:fs';
import FormData from 'form-data';
import fetch from 'node-fetch';

const GRAPH = 'https://graph.facebook.com/v21.0';

export class FacebookPublisher {
  constructor({ pageId, accessToken }) {
    if (!pageId || !accessToken) {
      console.warn('[facebook] pageId/accessToken missing — publisher will no-op');
    }
    this.pageId = pageId;
    this.token = accessToken;
  }

  enabled() {
    return Boolean(this.pageId && this.token);
  }

  async _uploadPhoto(filePath) {
    const form = new FormData();
    form.append('source', fs.createReadStream(filePath));
    form.append('published', 'false');
    form.append('access_token', this.token);

    const res = await fetch(`${GRAPH}/${this.pageId}/photos`, {
      method: 'POST',
      body: form,
      headers: form.getHeaders()
    });
    const data = await res.json();
    if (data.error) throw new Error(`[facebook] photo upload: ${data.error.message}`);
    return data.id;
  }

  async sendCarousel(imagePaths, caption) {
    if (!this.enabled()) {
      return { ok: false, skipped: true, reason: 'token_missing' };
    }
    const photoIds = [];
    for (const p of imagePaths) {
      photoIds.push(await this._uploadPhoto(p));
    }
    const params = new URLSearchParams({
      message: caption,
      access_token: this.token
    });
    photoIds.forEach((id, i) => {
      params.append(`attached_media[${i}]`, JSON.stringify({ media_fbid: id }));
    });

    const res = await fetch(`${GRAPH}/${this.pageId}/feed`, {
      method: 'POST',
      body: params
    });
    const data = await res.json();
    if (data.error) throw new Error(`[facebook] feed post: ${data.error.message}`);
    return { ok: true, post_id: data.id, permalink: `https://facebook.com/${data.id}` };
  }
}
