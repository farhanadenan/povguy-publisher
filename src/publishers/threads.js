/**
 * Threads publisher via Meta Threads Graph API.
 *
 * Carousel flow (Threads supports up to 10 items per post):
 *   1. Create child item containers for each image: POST /{user-id}/threads with media_type=IMAGE, image_url, is_carousel_item=true
 *   2. Create parent carousel container: POST /{user-id}/threads with media_type=CAROUSEL, children=[ids], text=caption
 *   3. Publish: POST /{user-id}/threads_publish with creation_id=parent
 *
 * NOTE: image_url must be PUBLIC HTTPS URL. We need to host slides somewhere reachable
 *       (Cloudflare R2, Vercel Blob, or commit to a public-images repo). Phase 1: use
 *       Vercel Blob via simple uploader script (TODO).
 *
 * Required scopes: threads_basic, threads_content_publish
 *
 * Status: scaffold only. Needs token + image hosting before activating.
 */

import fetch from 'node-fetch';

const GRAPH = 'https://graph.threads.net/v1.0';

export class ThreadsPublisher {
  constructor({ userId, accessToken }) {
    this.userId = userId;
    this.token = accessToken;
  }

  enabled() {
    return Boolean(this.userId && this.token);
  }

  async _createChild(imageUrl) {
    const res = await fetch(`${GRAPH}/${this.userId}/threads`, {
      method: 'POST',
      body: new URLSearchParams({
        media_type: 'IMAGE',
        image_url: imageUrl,
        is_carousel_item: 'true',
        access_token: this.token
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(`[threads] child create: ${data.error.message}`);
    return data.id;
  }

  async sendCarousel(publicImageUrls, caption) {
    if (!this.enabled()) return { ok: false, skipped: true, reason: 'token_missing' };

    const childIds = [];
    for (const url of publicImageUrls) {
      childIds.push(await this._createChild(url));
    }

    const parentRes = await fetch(`${GRAPH}/${this.userId}/threads`, {
      method: 'POST',
      body: new URLSearchParams({
        media_type: 'CAROUSEL',
        children: childIds.join(','),
        text: caption,
        access_token: this.token
      })
    });
    const parent = await parentRes.json();
    if (parent.error) throw new Error(`[threads] parent create: ${parent.error.message}`);

    // Threads recommends a 30-second wait before publishing
    await new Promise(r => setTimeout(r, 30_000));

    const pubRes = await fetch(`${GRAPH}/${this.userId}/threads_publish`, {
      method: 'POST',
      body: new URLSearchParams({
        creation_id: parent.id,
        access_token: this.token
      })
    });
    const pub = await pubRes.json();
    if (pub.error) throw new Error(`[threads] publish: ${pub.error.message}`);
    return { ok: true, post_id: pub.id };
  }
}
