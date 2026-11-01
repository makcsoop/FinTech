"""Вход в Telegram для сессии сборщика (cbr_watch) по QR-коду — без кода подтверждения.

QR сканирует телефон, где этот аккаунт уже открыт: Telegram → Настройки → Устройства →
«Подключить устройство». Пароль двухфакторной защиты, если включён, вводит владелец.
"""
import asyncio
import getpass
from datetime import datetime
import os
from pathlib import Path

import qrcode
from telethon import TelegramClient, errors

API_ID = int(os.environ["TELEGRAM_API_ID"])
API_HASH = os.environ["TELEGRAM_API_HASH"]
SESSION = os.environ.get("TELEGRAM_SESSION", "./data/telegram/cbr_watch")


def show(url: str) -> None:
    q = qrcode.QRCode(border=2)
    q.add_data(url)
    print("\n" * 2)
    q.print_ascii(invert=True)
    print("Telegram на телефоне → Настройки → Устройства → «Подключить устройство» → наведите камеру.")
    print("Код обновляется каждые ~30 с, новый появится сам.\n")


async def main() -> None:
    Path(SESSION).parent.mkdir(parents=True, exist_ok=True)
    client = TelegramClient(SESSION, API_ID, API_HASH, connection_retries=10, retry_delay=2)
    await client.connect()
    try:
        if await client.is_user_authorized():
            me = await client.get_me()
            print(f"Уже вошли как {me.first_name} (@{me.username}). Сессия: {SESSION}.session")
            return
        qr = await client.qr_login()
        while True:
            show(qr.url)
            try:
                await qr.wait(timeout=max(5, int((qr.expires - datetime.now(qr.expires.tzinfo)).total_seconds())))
                break
            except asyncio.TimeoutError:
                await qr.recreate()
            except errors.SessionPasswordNeededError:
                await client.sign_in(password=getpass.getpass("Облачный пароль (двухфакторная защита): "))
                break
        me = await client.get_me()
        print(f"\nВошли как {me.first_name} (@{me.username}). Сессия: {SESSION}.session")
    finally:
        await client.disconnect()


asyncio.run(main())
