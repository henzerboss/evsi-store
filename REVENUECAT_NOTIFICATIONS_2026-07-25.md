# RevenueCat Telegram notifications — 2026-07-25

## Что изменено

- Индивидуальные уведомления сокращены до полей: проект, страна, сумма, товар, магазин, период, renewal number, trial conversion и user.
- События с `period_type=TRIAL` больше не отправляются отдельными Telegram-сообщениями.
- `BILLING_ISSUE` больше не отправляется отдельным Telegram-сообщением.
- Триалы и проблемы с оплатой продолжают учитываться в ежедневной сводке.
- Добавлен проект `evpdf` → `evPDF`.
- Добавлена ежедневная сводка без БД: события сохраняются в JSONL-файлы на диске.

## RevenueCat webhook для evPDF

URL:

```text
https://evsi.store/api/webhooks/revenuecat?project=evpdf
```

Можно использовать общий секрет:

```env
REVENUECAT_WEBHOOK_AUTH=Bearer YOUR_SECRET
```

Или отдельный секрет для evPDF:

```env
REVENUECAT_WEBHOOK_AUTH_EVPDF=Bearer YOUR_SECRET
```

При необходимости отдельный Telegram-чат:

```env
TELEGRAM_CHAT_ID_RC_EVPDF=123456789
```

Если переменная не задана, используется `TELEGRAM_CHAT_ID_RC`, затем `TELEGRAM_CHAT_ID`.

## Ежедневная сводка без БД

Рекомендуемые переменные:

```env
# Можно использовать уже существующий CRON_SECRET вместо отдельного секрета.
REVENUECAT_DAILY_SUMMARY_SECRET=YOUR_LONG_RANDOM_SECRET

# Общий чат для сводки. Если не задан, используются TELEGRAM_CHAT_ID_RC / TELEGRAM_CHAT_ID.
TELEGRAM_CHAT_ID_RC_DAILY_SUMMARY=123456789

# Рекомендуется абсолютный путь вне папки релиза, чтобы файлы не терялись при замене проекта.
REVENUECAT_SUMMARY_DIR=/var/lib/evsi-store/revenuecat-summary

# Sandbox по умолчанию в сводку не попадает.
REVENUECAT_DAILY_SUMMARY_INCLUDE_SANDBOX=false

# Срок хранения файлов и отметок об отправке.
REVENUECAT_DAILY_SUMMARY_RETENTION_DAYS=60
```

Создать каталог и дать права пользователю, от которого работает PM2:

```bash
sudo mkdir -p /var/lib/evsi-store/revenuecat-summary
sudo chown -R $USER:$USER /var/lib/evsi-store/revenuecat-summary
```

Проверка сводки за конкретную дату:

```bash
curl -fsS "https://evsi.store/api/cron/revenuecat-daily-summary?secret=YOUR_LONG_RANDOM_SECRET&date=2026-07-24&force=1"
```

`force=1` повторно отправляет уже отправленную сводку. В обычном cron его добавлять не нужно.

Crontab для отправки в 00:05 по времени Мадрида:

```cron
CRON_TZ=Europe/Madrid
5 0 * * * curl -fsS "https://evsi.store/api/cron/revenuecat-daily-summary?secret=YOUR_LONG_RANDOM_SECRET" >/dev/null 2>&1
```

После изменения `.env` и замены файлов перезапустить приложение с обновлением env:

```bash
pm2 restart evsi-store --update-env
```

## Ограничение варианта без БД

Файловое хранение надёжно для одного VPS и одного экземпляра приложения с постоянным диском. Для Vercel, нескольких серверов или нескольких независимых PM2-инстансов нужен общий persistent storage или БД, иначе часть событий может оказаться на разных дисках.
