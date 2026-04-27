"""
A&D HC-6Ki 通信テスト — COM6 / 9600bps / 7E1 固定
使い方: python test_scale.py
出力は test_scale.log にも書き出します。
"""
import sys
import time
import serial

PORT     = "COM6"
BAUDRATE = 9600
DATA     = serial.SEVENBITS
PARITY   = serial.PARITY_EVEN
STOP     = serial.STOPBITS_ONE

# 標準出力を tee する
class Tee:
    def __init__(self, *streams):
        self.streams = streams
    def write(self, s):
        for st in self.streams:
            st.write(s); st.flush()
    def flush(self):
        for st in self.streams:
            st.flush()

_logf = open("test_scale.log", "w", encoding="utf-8", buffering=1)
sys.stdout = Tee(sys.__stdout__, _logf)

print("=" * 50)
print(f"  A&D HC-6Ki 通信テスト")
print(f"  {PORT} / {BAUDRATE}bps / 7E1")
print("=" * 50)

try:
    ser = serial.Serial(
        port=PORT, baudrate=BAUDRATE,
        bytesize=DATA, parity=PARITY, stopbits=STOP,
        timeout=0.3,
    )
    print(f"\nポートを開きました: {PORT}\n")
except Exception as e:
    print(f"\nポートを開けませんでした: {e}")
    input("Enter で終了...")
    raise SystemExit(1)

# 出力要求コマンド送信
for cmd in [b"Q\r\n", b"?\r\n"]:
    try:
        ser.write(cmd)
    except Exception:
        pass

print("★ 秤の PRINT ボタンを押してください")
print("  （または重さを変えると自動で送ってくる場合もあります）")
print("  受信したデータをリアルタイム表示します。")
print("  Ctrl+C で終了。\n")

try:
    buf = b""
    t_end = time.monotonic() + 15  # 最大15秒
    while time.monotonic() < t_end:
        chunk = ser.read(128)
        if not chunk:
            continue
        buf += chunk
        # バイト列を16進 + ASCII で表示
        hex_str  = " ".join(f"{b:02X}" for b in chunk)
        try:
            text = chunk.decode("ascii", errors="replace")
            text = text.replace("\r", "\\r").replace("\n", "\\n")
        except Exception:
            text = "?"
        print(f"受信: [{hex_str}]")
        print(f"      '{text}'")

        # 行が揃ったらパース試行
        while b"\n" in buf or b"\r" in buf:
            for sep in [b"\r\n", b"\n", b"\r"]:
                if sep in buf:
                    line, buf = buf.split(sep, 1)
                    raw = line.decode("ascii", errors="replace").strip()
                    if raw:
                        print(f"→ 行: {repr(raw)}")
                    break

        # 次のデータを要求
        try:
            ser.write(b"Q\r\n")
        except Exception:
            pass

except KeyboardInterrupt:
    print("\n終了しました。")
finally:
    ser.close()
