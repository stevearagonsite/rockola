# Cloudflare Containers: feasibility (2026-11-25)

Verdict: **not deployed**. Running Rockola 24/7 on Cloudflare Containers cannot fit a USD 5/month
budget, and the account would first need the Workers Paid plan.

## Why Containers (and not plain Workers)

The bot needs a long-lived Discord gateway socket, UDP voice (DAVE), ffmpeg and yt-dlp. Workers and
Durable Objects can't do any of that; only a Container (started and kept alive by a Durable Object,
with a Worker in front) could.

## Findings

| Check | Result |
| --- | --- |
| Containers on the personal account | **No.** The account is on Workers Free; the API answers "Deploying containers requires the Workers Paid plan" (USD 5/month minimum). |
| Gateway login, UDP voice + DAVE, YouTube/Spotify/Suno from Cloudflare egress | **Not tested** (needs the paid plan). Cloudflare's docs don't say whether outbound UDP leaves a Container; that is the main technical risk. |
| Memory needed (local, linux image, 3 tracks resolved and played 30 s each) | cgroup peak **366 MiB** (includes page cache); CPU **13 s per 106 s** of activity (~0.12 vCPU). `lite` (256 MiB) is too small; smallest safe size: custom 1/8 vCPU, 512 MiB, 2 GB disk, or predefined `basic` (1/4 vCPU, 1 GiB, 4 GB). |
| yt-dlp in the Docker image | **Regression:** yt-dlp 2026.11.23 (what the image upgrades to at start) returns googlevideo URLs that ffmpeg gets **403 Forbidden** on (only very short videos play). Pinning 2026.10.26 works. Affects any Docker deploy, not just Cloudflare. |

## Cost for 24/7 (Cloudflare prices published Nov 2026)

730 h = 2,628,000 s. Included with Workers Paid: 25 GiB-h memory, 375 vCPU-min, 200 GB-h disk,
500 GB-1 TB egress. Rates: memory USD 0.0000025/GiB-s, CPU USD 0.00002/vCPU-s (active only),
disk USD 0.00000007/GB-s. CPU assumes ~2 h of playback a day.

| Item | custom 512 MiB / 2 GB | basic 1 GiB / 4 GB |
| --- | --- | --- |
| Workers Paid plan | 5.00 | 5.00 |
| Memory (provisioned) | 3.06 | 6.35 |
| Disk (provisioned) | 0.32 | 0.69 |
| CPU (active) | ~0.17 | ~0.17 |
| Egress (~4 GB Opus to Discord) | 0 | 0 |
| Durable Object (one, within included) | 0 | 0 |
| **Total / month** | **~USD 8.55** | **~USD 12.20** |

Even `lite` would be ~USD 6.90, and it runs out of memory.

## What could fit USD 5

Only "sleep when idle": the Worker receives slash commands over Discord's HTTP interactions
endpoint and wakes the Container on `/play`, which joins voice and sleeps after the queue ends.
With 512 MiB the included memory covers **~50 h of playback a month** (~1.6 h/day); every extra hour
costs ~USD 0.014. It needs a rewrite (HTTP interactions, gateway only while playing, no 24/7 mode,
no autocomplete while asleep) and the UDP question is still open. Not recommended for now: keep the
self-hosted instance (Mac, Windows PC as fallback).

## If it is ever deployed

- Set `ALLOWED_GUILD_IDS` (SA and Edwork) as a plain `vars` entry in `wrangler.jsonc`; secrets
  (`DISCORD_TOKEN`, Spotify) only through `wrangler secret put`.
- The Worker exposes no HTTP route that starts, stops or controls the Container: keep-alive comes
  from Durable Object alarms. The only public route allowed is Discord's interactions endpoint, and
  only with Ed25519 signature verification.
- Pin yt-dlp (see the regression above) before building the image.
