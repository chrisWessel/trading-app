import os
import sys
import requests
from typing import Dict, Any, Optional

# Force UTF-8 output encoding for Windows terminals
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
        sys.stderr.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

def format_signal_message(symbol: str, signal_type: str, entry: float, sl: float, tp1: float, tp2: float, rationale: str) -> str:
    """
    Format message matching exact user specification template.
    """
    return (
        f"🚨 **NEW COMMERCIAL TRADE SIGNAL** 🚨\n"
        f"📌 Pair: {symbol} | Action: {signal_type}\n"
        f"💵 Entry Zone: ${entry:.4f} | 🛑 Stop-Loss: ${sl:.4f}\n"
        f"🎯 Target 1 (50%): ${tp1:.4f} | 🎯 Target 2 (Runner): ${tp2:.4f}\n"
        f"🧠 System Rationale: {rationale}"
    )

def send_telegram_signal(
    symbol: str,
    signal_type: str,
    entry: float,
    sl: float,
    tp1: float,
    tp2: float,
    rationale: str,
    bot_token: Optional[str] = None,
    chat_id: Optional[str] = None
) -> Dict[str, Any]:
    token = bot_token or os.getenv("TELEGRAM_BOT_TOKEN", TELEGRAM_BOT_TOKEN)
    cid = chat_id or os.getenv("TELEGRAM_CHAT_ID", TELEGRAM_CHAT_ID)
    
    message = format_signal_message(
        symbol=symbol,
        signal_type=signal_type,
        entry=entry,
        sl=sl,
        tp1=tp1,
        tp2=tp2,
        rationale=rationale
    )

    if not token or not cid or token.startswith("YOUR_") or cid.startswith("YOUR_"):
        try:
            dry_run_text = f"[Telegram Bot - Dry Run / Simulation Mode]\n------------------------------------------\n{message}\n------------------------------------------\n"
            sys.stdout.buffer.write(dry_run_text.encode('utf-8', errors='replace'))
            sys.stdout.flush()
        except Exception:
            pass
        return {
            "status": "simulated",
            "message": "Telegram signal generated in simulation mode (Bot Token / Chat ID not set).",
            "formatted_text": message
        }

    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": cid,
        "text": message,
        "parse_mode": "Markdown"
    }

    try:
        response = requests.post(url, json=payload, timeout=8)
        res_data = response.json()
        if response.status_code == 200 and res_data.get("ok"):
            return {
                "status": "success",
                "message": "Signal dispatched to Telegram channel successfully.",
                "formatted_text": message
            }
        else:
            return {
                "status": "error",
                "message": f"Telegram API error: {res_data.get('description', 'Unknown error')}",
                "formatted_text": message
            }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Failed to connect to Telegram API: {str(e)}",
            "formatted_text": message
        }

if __name__ == "__main__":
    res = send_telegram_signal(
        symbol="REXT/USDT",
        signal_type="BUY/LONG",
        entry=0.0450,
        sl=0.0432,
        tp1=0.0485,
        tp2=0.0520,
        rationale="Retesting 0.0450 Support zone with 2.1x volume surge & +0.42 OBI score."
    )
    print("Test broadcast result:", res)
