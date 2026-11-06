# 🇩🇪 ربات بله — دیکشنری آلمانی به فارسی + جعبه لایتنر

ربات عمومی پیام‌رسان **بله**: کاربر کلمه‌ی آلمانی می‌فرستد و می‌گیرد:

- **آرتیکل** (`der / die / das`) و **حالت جمع**
- **توضیح کلمه به زبان آلمانی**
- **معنی فارسی**

و می‌تواند هر کلمه را به **جعبه‌ی لایتنر** خودش اضافه کند، انتخاب کند هر چند روز یک‌بار مرور شود، و ربات سر وقت برای مرور پیام می‌دهد.

> نمونه خروجی برای `Haus`:
> ```
> 🇩🇪 das Haus
> 🔊 /haʊ̯s/
> 🔤 جمع: die Häuser
>
> 📖 توضیح به آلمانی:
> 1. zu einem bestimmten Zweck erbautes Gebäude
> 2. zum Wohnen dienendes und genutztes Gebäude
>
> 🇮🇷 معنی فارسی: خانه
> ```

## معماری

| بخش | انتخاب | چرا |
|---|---|---|
| میزبانی | **Vercel Serverless** (`api/webhook.js`) | رایگان، بدون سرور روشن دائمی، اتصال مستقیم از گیت‌هاب |
| API بله | `https://tapi.bale.ai/bot<TOKEN>/…` | هم‌شکل تلگرام: `sendMessage`، دکمه شیشه‌ای، `callback_query` |
| منبع دیکشنری | **de.wiktionary.org** (بدون کلید) | آرتیکل/جمع/توضیح آلمانی از خود مدخل آلمانی |
| معنی فارسی | **MyMemory** `de→fa` (بدون کلید) | با fallback زنجیره‌ای `de→en→fa` |
| دیتابیس لایتنر | **Upstash Redis** (REST، رایگان) | توابع ورسل حافظه‌ی دائمی ندارند؛ لایتنر باید بماند |
| مرور خودکار | **Vercel Cron** روزانه ۰۸:۰۰ تهران | `api/cron/review.js` — در `vercel.json` |

## منطق لایتنر

- هنگام افزودن، کاربر بازه را انتخاب می‌کند: **هر روز / هر ۳ روز / هر هفته**.
- کارت از **خانه‌ی ۱** شروع می‌کند؛ اولین مرور بعد از همان بازه است.
- «✅ بلدم» ← یک خانه بالاتر و فاصله دو برابر می‌شود (بازه × ۲^(خانه−۱)، سقف ۶۰ روز).
- «❌ بلد نیستم» ← برگشت به خانه‌ی ۱.
- دستورها: `/mywords` فهرست کارت‌ها، `/review` شروع مرور رسیده‌ها، `/due` شمارش امروز.

## راه‌اندازی قدم‌به‌قدم

### ۱) ساخت ربات در بله
در بله به **بات‌فادر (@BotFather)** پیام بدهید، ربات جدید بسازید و **توکن** را نگه دارید. توکن را در چت/کد ننویسید؛ فقط در Environment Variables ورسل وارد می‌شود.

### ۲) دیتابیس Upstash (رایگان)
در [console.upstash.com](https://console.upstash.com) یک Redis بسازید و از بخش **REST API** دو مقدار `UPSTASH_REDIS_REST_URL` و `UPSTASH_REDIS_REST_TOKEN` را بردارید.

### ۳) گیت‌هاب → ورسل
1. این پوشه را در یک ریپوی گیت‌هاب پوش کنید (دستورهای پایین).
2. در [vercel.com](https://vercel.com) → **Add New → Project** → همان ریپو را Import کنید (تنظیم خاصی لازم نیست؛ فریم‌ورک: Other).
3. در بخش **Environment Variables** پروژه‌ی ورسل این‌ها را بگذارید (از `.env.example`):
   - `BALE_BOT_TOKEN`
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`
   - `SETUP_SECRET` (یک رمز دلخواه)
   - `CRON_SECRET` (یک رشته‌ی تصادفی)
4. **Deploy** کنید.

### ۴) تنظیم وبهوک (یک بار)
مرورگر را باز کنید:
```
https://<your-app>.vercel.app/api/setup?secret=<SETUP_SECRET>
```
باید `bot` و `"webhook":{"ok":true}` ببینید. حالا در بله به رباتتان پیام بدهید. 🎉

از این به بعد هر **push به گیت‌هاب = دیپلوی خودکار در ورسل**.

```bash
git init
git add .
git commit -m "Bale German-Persian dictionary bot with Leitner box"
git branch -M main
git remote add origin https://github.com/<YOUR-USERNAME>/<REPO>.git
git push -u origin main
```

## تست محلی

```bash
npm test   # جست‌وجوی واقعی Haus/Wasser/gehen + چرخه‌ی کامل لایتنر (بدون توکن بله)
```

## ساختار پروژه

```
api/
  webhook.js       # ورودی آپدیت‌های بله: جست‌وجو، دستورها، دکمه‌ها
  cron/review.js   # یادآوری روزانه‌ی مرور (Vercel Cron)
  setup.js         # تنظیم وبهوک بعد از دیپلوی
  health.js        # بررسی سلامت
lib/
  bale.js          # کلاینت API بله
  dictionary.js    # ویکی‌واژه (آرتیکل/جمع/توضیح) + معنی فارسی + کش ۳۰روزه
  leitner.js       # منطق جعبه‌ی لایتنر
  store.js         # Upstash Redis (REST) + fallback حافظه برای تست
scripts/test-local.mjs
vercel.json        # کرون روزانه
```

## محدودیت‌های صادقانه

- MyMemory رایگان سقف روزانه دارد (حدود ۱۰۰۰ کلمه/روز ناشناس)؛ کش ۳۰روزه‌ی دیکشنری فشار را خیلی کم می‌کند. برای ترافیک بالا بعداً می‌شود کلید DeepL/ترجمه اضافه کرد — جای آن در `lib/dictionary.js` (`translateToPersian`) مشخص است.
- همه‌ی کلمات آلمانی در ویکی‌واژه مدخل کامل ندارند؛ کلمه‌ی پیدا‌نشده با پیام روشن جواب داده می‌شود.
- افعال و صفت‌ها آرتیکل/جمع ندارند؛ به‌جای آن «نوع کلمه» نمایش داده می‌شود.
