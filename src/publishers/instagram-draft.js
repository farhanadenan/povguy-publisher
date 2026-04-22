/**
 * Instagram publisher — TWO MODES depending on App Review status.
 *
 * Mode A (interim, until App Review clears):
 *   Queue carousel as a draft in Meta Business Suite via Creator Studio API.
 *   Farhan publishes manually from his phone.
 *   Endpoint: POST /{ig-business-id}/media with is_carousel_item=true + parent container
 *
 * Mode B (post-App Review, ENABLE_INSTAGRAM_LIVE=true):
 *   Publish directly via instagram_content_publish scope.
 *
 * NOTE: Instagram requires public HTTPS image URLs (same as Threads).
 *       Use the same image hosting pipeline.
 *
 * Status: scaffold. The "draft to Business Suite" flow is somewhat undocumented —
 *         Meta's official path is to use the same /media → /media_publish flow but
 *         skip the publish step and the post sits in Composer drafts. We'll prove
 *         this in a side test when token is available.
 */

import fetch from 'node-fetch';

const GRAPH = 'https://graph.facebook.com/v21.0';

export class InstagramPublisher {
  constructor({ igBusinessId, accessToken, liveEnabled = false }) {
    this.igId = igBusinessId;
    this.token = accessToken;
    this.live = liveEnabled;
  }

  enabled() {
    return Boolean(this.igId && this.token);
  }

  async _createChild(imageUrl) {
    const res = await fetch(`${GRAPH}/${this.igId}/media`, {
      method: 'POST',
      body: new URLSearchParams({
        image_url: imageUrl,
        is_carousel_item: 'true',
        access_token: this.token
      })
    });
    const data = await res.json();
    if (data.error) throw new Error(`[instagram] child: ${data.error.message}`);
    return data.id;
  }

  async sendCarousel(publicImageUrls, caption) {
    if (!this.enabled()) return { ok: false, skipped: true, reason: 'token_missing' };

    const childIds = [];
    for (const url of publicImageUrls) {
      childIds.push(await this._createChild(url));
    }

    // Create parent container (carousel)
    const parentRes = await fetch(`${GRAPH}/${this.igId}/media`, {
      method: 'POST',
      body: new URLSearchParams({
        media_type: 'CAROUSEL',
        children: childIds.join(','),
        caption,
        access_token: this.token
      })
    });
    const parent = await parentRes.json();
    if (parent.error) throw new Error(`[instagram] parent: ${parent.error.message}`);

    if (!this.live) {
      // Draft mode — leave it in container state, do not publish
      return {
        ok: true,
        mode: 'draft',
        creation_id: parent.id,
        note: 'Draft created. Open Meta Business Suite → Composer → Drafts to publish manually.'
      };
    }

    // Live mode — publish (requires App Review approval)
    const pubRes = await fetch(`${GRAPH}/${this.igId}/media_publish`, {
      method: 'POST',
      body: new URLSearchParams({
        creation_id: parent.id,
        access_token: this.token
      })
    });
    const pub = await pubRes.json();
    if (pub.error) throw new Error(`[instagram] publish: ${pub.error.message}`);
    return { ok: true, mode: 'live', post_id: pub.id };
  }
}
