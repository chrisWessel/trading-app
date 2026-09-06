import os
import sqlite3
import pandas as pd
from datetime import datetime
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

DB_DIR = os.path.dirname(os.path.abspath(__file__))
DB_NAME = os.path.join(DB_DIR, "trade_signals.db")
DATABASE_URL = os.getenv("DATABASE_URL")

def get_db_connection():
    if DATABASE_URL:
        import psycopg2
        url = DATABASE_URL
        if url.startswith("postgres://"):
            url = url.replace("postgres://", "postgresql://", 1)
        return psycopg2.connect(url)
    return sqlite3.connect(DB_NAME)

def init_db():
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        if DATABASE_URL:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS closed_signals (
                    id SERIAL PRIMARY KEY,
                    timestamp VARCHAR(50) NOT NULL,
                    symbol VARCHAR(20) NOT NULL,
                    signal_type VARCHAR(20) NOT NULL,
                    entry_price DOUBLE PRECISION NOT NULL,
                    exit_price DOUBLE PRECISION NOT NULL,
                    stop_loss DOUBLE PRECISION NOT NULL,
                    take_profit DOUBLE PRECISION NOT NULL,
                    position_size_usd DOUBLE PRECISION DEFAULT 100.0,
                    outcome VARCHAR(10) NOT NULL,
                    pnl_usd DOUBLE PRECISION NOT NULL,
                    pnl_percentage DOUBLE PRECISION NOT NULL,
                    rationale TEXT
                );
            """)
        else:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS closed_signals (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    symbol TEXT NOT NULL,
                    signal_type TEXT NOT NULL,
                    entry_price REAL NOT NULL,
                    exit_price REAL NOT NULL,
                    stop_loss REAL NOT NULL,
                    take_profit REAL NOT NULL,
                    position_size_usd REAL NOT NULL,
                    outcome TEXT NOT NULL,
                    pnl_usd REAL NOT NULL,
                    pnl_percentage REAL NOT NULL,
                    rationale TEXT
                )
            """)
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Error initializing DB: {e}")

def log_closed_trade(symbol, signal_type, entry, exit_p, sl, tp, size_usd, outcome, rationale=""):
    if any(k in signal_type.upper() for k in ["BUY", "LONG"]):
        pnl_pct = ((exit_p - entry) / entry) * 100
    else:
        pnl_pct = ((entry - exit_p) / entry) * 100
        
    pnl_usd = size_usd * (pnl_pct / 100)
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    conn = get_db_connection()
    cursor = conn.cursor()
    placeholder = "%s" if DATABASE_URL else "?"
    query = f"""
        INSERT INTO closed_signals 
        (timestamp, symbol, signal_type, entry_price, exit_price, stop_loss, take_profit, position_size_usd, outcome, pnl_usd, pnl_percentage, rationale)
        VALUES ({placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder}, {placeholder})
    """
    cursor.execute(query, (timestamp, symbol, signal_type, entry, exit_p, sl, tp, size_usd, outcome, pnl_usd, pnl_pct, rationale))
    conn.commit()
    conn.close()

def generate_pdf_monthly_report(year_month=None):
    if year_month is None:
        year_month = datetime.now().strftime("%Y-%m")
        
    conn = get_db_connection()
    query = f"SELECT * FROM closed_signals WHERE timestamp LIKE '{year_month}%'"
    df = pd.read_sql_query(query, conn)
    conn.close()

    if df.empty:
        return None

    pdf_filename = os.path.join(DB_DIR, f"monthly_performance_report_{year_month}.pdf")
    doc = SimpleDocTemplate(pdf_filename, pagesize=letter)
    styles = getSampleStyleSheet()
    story = []

    title_style = ParagraphStyle('TitleStyle', parent=styles['Heading1'], fontSize=18, textColor=colors.HexColor('#1E293B'))
    story.append(Paragraph(f"WesSignal Terminal - Monthly Performance Report ({year_month})", title_style))
    story.append(Spacer(1, 15))

    total_trades = len(df)
    wins = len(df[df['outcome'] == 'WIN'])
    losses = len(df[df['outcome'] == 'LOSS'])
    win_rate = (wins / total_trades) * 100 if total_trades > 0 else 0
    total_pnl = df['pnl_usd'].sum()

    summary_data = [
        ["Total Trades", "Win Rate", "Wins / Losses", "Net Realized PnL"],
        [str(total_trades), f"{win_rate:.1f}%", f"{wins} / {losses}", f"${total_pnl:.2f}"]
    ]
    
    t_summary = Table(summary_data, colWidths=[120, 120, 120, 140])
    t_summary.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#0F172A')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('FONTNAME', (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('BOTTOMPADDING', (0, 0), (-1, 0), 8),
        ('BACKGROUND', (0, 1), (-1, 1), colors.HexColor('#F8FAFC')),
        ('GRID', (0, 0), (-1, -1), 1, colors.HexColor('#E2E8F0'))
    ]))
    story.append(t_summary)
    story.append(Spacer(1, 20))

    story.append(Paragraph("Closed Trades Audit Log", styles['Heading2']))
    story.append(Spacer(1, 10))

    log_headers = [["Timestamp", "Symbol", "Type", "Entry", "Exit", "Outcome", "PnL ($)"]]
    log_rows = []
    for _, row in df.iterrows():
        log_rows.append([
            str(row['timestamp'])[:16], str(row['symbol']), str(row['signal_type']),
            f"${float(row['entry_price']):.4f}", f"${float(row['exit_price']):.4f}",
            str(row['outcome']), f"${float(row['pnl_usd']):.2f}"
        ])

    t_log = Table(log_headers + log_rows, colWidths=[100, 70, 50, 70, 70, 70, 70])
    t_log.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#334155')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.whitesmoke),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#CBD5E1'))
    ]))
    story.append(t_log)

    doc.build(story)
    return pdf_filename

def get_all_closed_trades():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, timestamp, symbol, signal_type, entry_price, exit_price, stop_loss, take_profit, position_size_usd, outcome, pnl_usd, pnl_percentage, rationale FROM closed_signals ORDER BY id DESC")
    rows = cursor.fetchall()
    conn.close()
    
    trades = []
    for row in rows:
        trades.append({
            "id": row[0],
            "timestamp": str(row[1]),
            "symbol": row[2],
            "signal_type": row[3],
            "entry_price": float(row[4]),
            "exit_price": float(row[5]),
            "stop_loss": float(row[6]),
            "take_profit": float(row[7]),
            "position_size_usd": float(row[8]),
            "outcome": row[9],
            "pnl_usd": float(row[10]),
            "pnl_percentage": float(row[11]),
            "rationale": row[12]
        })
    return trades

if __name__ == "__main__":
    init_db()
    print("Database initialized successfully!")
