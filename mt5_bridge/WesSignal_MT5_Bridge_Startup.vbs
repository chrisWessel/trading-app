Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "c:\Users\Admin\Desktop\Trading App\mt5_bridge"
WshShell.Run """c:\Users\Admin\Desktop\Trading App\.venv\Scripts\pythonw.exe"" ""c:\Users\Admin\Desktop\Trading App\mt5_bridge\server.py""", 0, False

