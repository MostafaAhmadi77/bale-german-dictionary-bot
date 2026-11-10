# 33Bayan — Bale Bot 🇩🇪

A public bot for the **Bale** messenger: a German ⇄ Persian dictionary with a built-in **Leitner box** for spaced-repetition vocabulary review.

Send a German word and get back:

- **Article** (`der / die / das`) and **plural form**
- **German definitions**, usage examples and collocations (enriched with DWDS)
- **Persian meaning**, synonyms and antonyms
- A **photo** for concrete words, and **audio pronunciation** (normal and slow)

Every word can be saved to your personal Leitner box, and the bot reminds you when reviews are due. Persian words work in reverse, too: send a Persian word and get its German equivalents. Full sentences are translated as text.

> Example output for `Haus`:
> ```
> 🇩🇪 das Haus
> 🔊 /haʊ̯s/
> 🔤 Plural: die Häuser
>
> 📖 German definition:
> 1. zu einem bestimmten Zweck erbautes Gebäude
> 2. zum Wohnen dienendes und genutztes Gebäude
>
> 🇮🇷 Persian meaning: خانه
> ```

**Live bot:** [@32bayanbot](https://ble.ir/32bayanbot) · **Deployment:** https://bale-german-dictionary-bot.vercel.app

This backend also powers the **33Bayan mobile app** — see [api/app.js](#mobile-app-api) below and the app repo: https://github.com/MostafaAhmadi77/33Bayan

## Features

- **Bidirectional dictionary** — German → Persian entries from de.wiktionary.org, enriched with examples, collocations, synonyms and antonyms from DWDS; Persian → German reverse lookup
- **Text translation** — sentences (4+ words are auto-detected) are translated with automatic direction detection. Engine chain: DeepL (when a key is configured) → Google Translate (GTX) → MyMemory, with results cached for 30 days and a 2,000-character cap per message
- **Images** — real photos resolved in order: Wikimedia Commons → Openverse → Pixabay (when a key is configured), with AI-generated images as a last resort for nouns
- **AI review** — every entry and image is checked by Google Gemini before it is sent; the check fails open, so a lookup never breaks if the AI is unavailable
- **Pronunciation** — in-chat audio generated with Google TTS, with a slow-playback (0.3×) option
- **Leitner box** — spaced repetition with a daily review reminder (Vercel Cron, 08:00 Tehran time)
- **Feedback & admin inbox** — users can send feedback from inside the bot; the admin replies from an in-bot inbox
- **Optional registration gate** — when enabled by the admin, new users fill in a short form and are approved or rejected by the admin before they can use the bot (off by default)
- **Home button** — every answer carries a button that resets the session to the main menu

## Architecture

| Part | Choice | Why |
|---|---|---|
| Hosting | **Vercel Serverless** (`api/webhook.js`) | Free, no always-on server, deploys directly from GitHub |
| Bale API | `https://tapi.bale.ai/bot<TOKEN>/…` | Telegram-style API: `sendMessage`, inline buttons, `callback_query` |
| Dictionary source | **de.wiktionary.org** (no key required) | Article, plural and German definitions come from the German entry itself |
| Enrichment | **DWDS** (dwds.de) | Examples, collocations, synonyms and antonyms |
| Persian meaning | Wiktionary translations, with a **MyMemory / Google / DeepL** fallback chain | Best available source first, graceful fallback after that |
| Leitner storage | **Upstash Redis** (REST, free tier) | Vercel functions are stateless; Leitner cards must persist |
| Scheduled reviews | **Vercel Cron**, daily 08:00 Tehran | `api/cron/review.js`, configured in `vercel.json` |
| AI review | **Google Gemini** (`gemini-flash-lite-latest`) | Fast pre-send check of entries and images |

## How the Leitner box works

- When adding a word, the user picks a review interval: **every day / every 3 days / every week**.
- A card starts in **box 1**; the first review is due after the chosen interval.
- **“✅ I know it”** moves the card one box up and doubles the interval (base × 2^(box−1), capped at 60 days).
- **“❌ I don't know it”** sends the card back to box 1.
- Commands: `/mywords` lists your cards, `/review` starts a review of due cards, `/due` shows today's count.

## Setup

### 1) Create the bot in Bale

Message **BotFather (@BotFather)** in Bale, create a new bot and keep the **token**. Never put the token in code or chat — it only goes into Vercel Environment Variables.

### 2) Create the Upstash database (free)

At [console.upstash.com](https://console.upstash.com), create a Redis database and copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` from the **REST API** section.

### 3) GitHub → Vercel

1. Push this folder to a GitHub repository.
2. In [vercel.com](https://vercel.com) choose **Add New → Project** and import that repository (no special settings; framework: Other).
3. Add these **Environment Variables** (see `.env.example`):
   - `BALE_BOT_TOKEN`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `SETUP_SECRET` (any password you choose)
   - `CRON_SECRET` (a random string)
   - Optional: `GEMINI_API_KEY` (AI review), `DEEPL_API_KEY` (better text translation), `PIXABAY_API_KEY` (more photos)
4. Click **Deploy**.

### 4) Set the webhook (one time)

Open in a browser:

```
https://<your-app>.vercel.app/api/setup?secret=<SETUP_SECRET>
```

You should see the `bot` info and `"webhook":{"ok":true}`. Now message your bot in Bale. 🎉

From here on, every **push to GitHub deploys automatically to Vercel**.

```bash
git init
git add .
git commit -m "Bale German-Persian dictionary bot with Leitner box"
git branch -M main
git remote add origin https://github.com/<YOUR-USERNAME>/<REPO>.git
git push -u origin main
```

## Mobile app API

`api/app.js` exposes the same engine as JSON for the 33Bayan mobile app (React Native / Expo). App users are identified by a random on-device ID, and their Leitner cards are stored separately under an `app:` prefix.

- `GET /api/app?action=lookup&dir=de&q=Hund` — full German entry
- `GET /api/app?action=lookup&dir=fa&q=سگ` — German equivalents for a Persian word
- `POST /api/app?action=translate` — text translation (direction detected automatically)
- `leitner.list` / `leitner.due` / `leitner.add` / `leitner.review` / `leitner.remove` — the app user's Leitner box
- Pronunciation reuses the existing endpoint: `/api/tts?t=der+Hund&raw=1`

## Local testing

```bash
npm test   # live lookups for Haus/Wasser/gehen + a full Leitner cycle (no Bale token needed)
```

## Project structure

```
api/
  webhook.js       # Bale update entry point: lookups, commands, buttons
  app.js           # JSON API for the 33Bayan mobile app
  tts.js           # pronunciation audio endpoint
  cron/review.js   # daily review reminders (Vercel Cron)
  setup.js         # one-time webhook setup after deploy
  health.js        # health check
lib/
  bale.js          # Bale API client
  dictionary.js    # Wiktionary entries + Persian meaning + 30-day cache
  dwds.js          # DWDS examples, collocations, synonyms/antonyms
  translate.js     # text translation (DeepL → Google GTX → MyMemory)
  media.js         # photo resolution (Commons → Openverse → Pixabay → generated)
  ai-check.js      # Gemini review of entries and images before sending
  leitner.js       # Leitner box logic
  auth.js          # optional registration / approval gate
  feedback.js      # user feedback + admin inbox
  store.js         # Upstash Redis (REST) + in-memory fallback for local tests
scripts/test-local.mjs
vercel.json        # daily cron + function settings
```

## Honest limitations

- The free MyMemory tier has a daily quota (roughly 1,000 words/day anonymously); the 30-day dictionary cache keeps the pressure low. For heavy traffic, add a DeepL key — the integration point is in `lib/translate.js`.
- Not every German word has a complete Wiktionary entry; unknown words get a clear “not found” reply.
- Verbs and adjectives have no article or plural; their word type is shown instead.
- The Bale API cannot change the bot's name or profile photo — those are set manually through BotFather.
