#!/usr/bin/env node
/**
 * Daily orchestrator — reads CONTENT_DROP_DIR, posts according to PUBLISH_MODE.
 *
 * Drop folder structure (produced by povguy-content-engine):
 *   YYYY-MM-DD/
 *     slide-1.png ... slide-9.png
 *     caption.txt          (caption with hashtags)
 *     manifest.json        ({ drop_id, theme, hashtags, slides: [...], image_urls?: [...] })
 *
 * Modes:
 *   --preview-only   → post to staging only, return preview message ID
 *   --publish        → check kill switch, then post to all live platforms
 *   --dry-run        → log what would be posted, no API calls
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { TelegramPublisher } from './publishers/telegram.js';
import { FacebookPublisher } from './publishers/facebook.js';
import { ThreadsPublisher } from './publishers/threads.js';
import { InstagramPublisher } from './publishers/instagram-draft.js';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const argVal = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
};

const MODE = flag('--dry-run') ? 'dry'
  : flag('--preview-only') ? 'preview'
  : flag('--publish') ? 'publish'
  : (process.env.PUBLISH_MODE || 'dry');

const dateStr = argVal('--date') || new Date().toISOString().slice(0, 10);
const dropDir = path.join(process.env.CONTENT_DROP_DIR || './sample-drop', dateStr);

console.log(`[publisher] mode=${MODE} date=${dateStr} dir=${dropDir}`);

// --- Load drop ---
if (!fs.existsSync(dropDir)) {
  console.error(`[publisher] drop dir missing: ${dropDir}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(dropDir, 'manifest.json'), 'utf8'));
const caption = fs.readFileSync(path.join(dropDir, 'caption.txt'), 'utf8');
// Numeric sort by the digits in the filename — survives both legacy unpadded
// names (slide-1.png … slide-10.png) AND new zero-padded names (slide-01.png …
// slide-10.png). The bug we hit: alphabetical .sort() puts slide-10 second
// because '1' < '2' lexicographically. With this comparator it's slot 10 always.
const slidePaths = fs.readdirSync(dropDir)
  .filter(f => f.match(/^slide-\d+\.(png|jpg)$/))
  .sort((a, b) => {
    const na = parseInt(a.match(/(\d+)/)[1], 10);
    const nb = parseInt(b.match(/(\d+)/)[1], 10);
    return na - nb;
  })
  .map(f => path.join(dropDir, f));

console.log(`[publisher] loaded drop ${manifest.drop_id}: ${slidePaths.length} slides, caption ${caption.length}ch`);

// --- Init publishers ---
const tg = new TelegramPublisher({ botToken: process.env.TELEGRAM_BOT_TOKEN });
const fb = new FacebookPublisher({
  pageId: process.env.META_PAGE_ID,
  accessToken: process.env.META_PAGE_ACCESS_TOKEN
});
const th = new ThreadsPublisher({
  userId: process.env.META_THREADS_USER_ID,
  accessToken: process.env.META_PAGE_ACCESS_TOKEN
});
const ig = new InstagramPublisher({
  igBusinessId: process.env.META_INSTAGRAM_BUSINESS_ID,
  accessToken: process.env.META_PAGE_ACCESS_TOKEN,
  liveEnabled: process.env.ENABLE_INSTAGRAM_LIVE === 'true'
});

// --- Mode: dry-run ---
if (MODE === 'dry') {
  console.log('--- DRY RUN — would post: ---');
  console.log(`  Telegram main:    ${slidePaths.length} slides + caption (${caption.length}ch)`);
  console.log(`  Telegram staging: ${slidePaths.length} slides + caption + kill-switch hint`);
  console.log(`  Facebook:         ${fb.enabled() ? slidePaths.length + ' slides + caption' : 'SKIPPED (no token)'}`);
  console.log(`  Threads:          ${th.enabled() ? slidePaths.length + ' slides + caption' : 'SKIPPED (no token)'}`);
  console.log(`  Instagram:        ${ig.enabled() ? `${ig.live ? 'LIVE' : 'DRAFT'} ${slidePaths.length} slides` : 'SKIPPED (no token)'}`);
  process.exit(0);
}

// --- Mode: preview ---
if (MODE === 'preview') {
  const stagingId = process.env.TELEGRAM_STAGING_CHAT_ID;
  // Publish time is 10:00 SGT next day (cron '0 2 * * *' = 02:00 UTC).
  // Old schedule was 08:00 — kept failing to update the caption when the cron
  // moved (Farhan, 2026-04-23). If the schedule changes again, audit BOTH
  // daily-publish.yml AND this string in lockstep.
  const previewCaption =
    `🔬 PREVIEW · ${manifest.theme} · drop ${manifest.drop_id}\n` +
    `Reply <b>KILL</b> to abort 10:00 SGT publish.\n\n` +
    caption;
  const result = await tg.sendCarousel(stagingId, slidePaths, previewCaption);
  console.log(`[publisher] preview posted, first_message_id=${result.first_message_id}`);

  // Persist the preview message ID so the publish job can check kill status later
  fs.writeFileSync(
    path.join(dropDir, 'preview-state.json'),
    JSON.stringify({ preview_message_id: result.first_message_id, posted_at: new Date().toISOString() }, null, 2)
  );
  process.exit(0);
}

// --- Mode: publish ---
if (MODE === 'publish') {
  const stagingId = process.env.TELEGRAM_STAGING_CHAT_ID;
  const previewStatePath = path.join(dropDir, 'preview-state.json');

  // preview-state.json is written by the PREVIEW run on a different ephemeral
  // GitHub Actions runner. The publish runner starts fresh and the file isn't
  // currently passed across runs (workflow lacks a download-artifact step).
  // Fail SAFE: block publish rather than push without verifying kill status.
  // To unblock: manually run daily-publish with mode=publish OR set
  // SKIP_KILL_CHECK=true env var to publish without the kill check.
  if (!fs.existsSync(previewStatePath)) {
    if (process.env.SKIP_KILL_CHECK === 'true') {
      console.warn(`[publisher] preview-state.json missing — SKIP_KILL_CHECK=true, publishing anyway`);
    } else {
      console.error(
        `[publisher] BLOCKED: preview-state.json missing at ${previewStatePath}.\n` +
        `  This file is written by the preview run and not currently passed to the publish run.\n` +
        `  To publish manually: re-run this workflow with mode=publish AND override SKIP_KILL_CHECK=true,\n` +
        `  OR run preview-only first on the same runner (rare) so state lands locally.\n` +
        `  Architectural fix: add an actions/download-artifact step to daily-publish.yml.`
      );
      // Notify staging so Farhan sees the abort instead of finding silence.
      try {
        await tg.sendMessage(stagingId,
          `⚠️ Drop ${manifest.drop_id}: publish ABORTED — kill-state file missing.\n` +
          `Re-run daily-publish manually with mode=publish if you want it live.`
        );
      } catch {}
      process.exit(1);
    }
  }

  let killed = false;
  if (fs.existsSync(previewStatePath)) {
    const previewState = JSON.parse(fs.readFileSync(previewStatePath, 'utf8'));
    killed = await tg.wasKilled(stagingId, previewState.preview_message_id);
  }
  if (killed) {
    console.log(`[publisher] 🛑 kill marker detected — aborting publish for ${manifest.drop_id}`);
    await tg.sendMessage(stagingId, `🛑 Drop ${manifest.drop_id} killed. No publish.`);
    process.exit(0);
  }

  const results = {};
  results.telegram = await tg.sendCarousel(process.env.TELEGRAM_MAIN_CHAT_ID, slidePaths, caption);

  // FB / Threads / IG require public image URLs — assume manifest has them
  if (manifest.image_urls) {
    results.facebook = await fb.sendCarousel(slidePaths, caption);
    results.threads = await th.sendCarousel(manifest.image_urls, caption);
    results.instagram = await ig.sendCarousel(manifest.image_urls, caption);
  } else {
    console.warn('[publisher] manifest.image_urls missing — skipping FB/Threads/IG');
  }

  console.log('[publisher] publish complete:', JSON.stringify(results, null, 2));
  fs.writeFileSync(
    path.join(dropDir, 'publish-result.json'),
    JSON.stringify(results, null, 2)
  );
}
