"""A&D HC-6Ki シリアル秤の管理 (CameraManager と同形の singleton)。

【前提】秤側設定
  f-06-01 = 4  (コマンドモード)
  f-06-03 = 2  (一般機器用フォーマット)
  f-06-04 = 2  (9600 bps)
接続: 9600 / 7E1。10Hz で `?WT\\r\\n` をポーリングして応答を読む。
"""
import threading
import logging
import time
from dataclasses import dataclass, field

log = logging.getLogger("scale")
if not log.handlers:
    _h = logging.StreamHandler()
    _h.setFormatter(logging.Formatter("%(asctime)s [%(name)s] %(message)s", datefmt="%H:%M:%S"))
    log.addHandler(_h)
    log.setLevel(logging.INFO)

POLL_INTERVAL_S = 0.1  # 10 Hz


@dataclass
class ScaleReading:
    value_g: float
    stable: bool
    overload: bool
    raw: str
    received_at: float = field(default_factory=time.monotonic)


class ScaleManager:
    _instance = None
    _instance_lock = threading.Lock()

    def __new__(cls):
        if cls._instance is None:
            with cls._instance_lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._serial = None
        self._read_lock = threading.Lock()
        self._cmd_lock = threading.Lock()  # 手動コマンド投入用
        self._pending_cmd: tuple[str, str] | None = None  # (cmd, label)
        self._cmd_result: str | None = None
        self._cmd_event = threading.Event()
        self._latest: ScaleReading | None = None
        self._connected = False
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    # ── 接続管理 ──────────────────────────────────────────────

    def open(self, port: str, baudrate: int = 9600, data_bits: int = 7,
             parity: str = "E", stop_bits: int = 1, read_timeout_ms: int = 500,
             **_) -> bool:
        """HC-6Ki (コマンドモード) 接続。既定は 9600 / 7E1。"""
        import serial
        self.close()
        try:
            ser = serial.Serial(
                port=port,
                baudrate=baudrate,
                bytesize=data_bits,
                parity=parity,
                stopbits=stop_bits,
                timeout=read_timeout_ms / 1000,
            )
            ser.reset_input_buffer()
            with self._read_lock:
                self._serial = ser
                self._connected = True
            self._stop_event.clear()
            self._thread = threading.Thread(
                target=self._read_loop, daemon=True, name="scale-poll"
            )
            self._thread.start()
            log.info("秤接続: %s @ %d (%d%s%d)", port, baudrate, data_bits, parity, stop_bits)
            return True
        except Exception as e:
            log.warning("秤接続エラー: %s", e)
            return False

    def close(self):
        self._stop_event.set()
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2.0)
        self._thread = None
        with self._read_lock:
            if self._serial:
                try:
                    self._serial.close()
                except Exception:
                    pass
                self._serial = None
            self._connected = False
            self._latest = None

    # ── 状態取得 ──────────────────────────────────────────────

    def is_connected(self) -> bool:
        return self._connected

    def get_latest(self) -> ScaleReading | None:
        with self._read_lock:
            return self._latest

    # ── コマンド送信 ──────────────────────────────────────────

    def _submit_command(self, cmd: str, label: str, timeout_s: float = 3.0) -> str | None:
        """ポーリングスレッドにコマンドを投入して応答を待つ。
        ACK (0x06) なら 'ACK'、それ以外は生の文字列を返す。失敗時 None。
        """
        if not self._connected:
            return None
        with self._cmd_lock:
            self._cmd_result = None
            self._cmd_event.clear()
            self._pending_cmd = (cmd, label)
            if not self._cmd_event.wait(timeout=timeout_s):
                self._pending_cmd = None
                return None
            return self._cmd_result

    def tare(self) -> bool:
        """風袋引き (T)。ACK 応答で True。"""
        r = self._submit_command("T", "tare")
        return r == "ACK"

    def zero(self) -> bool:
        """ゼロ (Z)。ACK 応答で True。"""
        r = self._submit_command("Z", "zero")
        return r == "ACK"

    # ── 待機ヘルパー ──────────────────────────────────────────

    def wait_stable(self, timeout_ms: int = 3000,
                    within_g: float | None = None) -> ScaleReading | None:
        """ST(安定)受信まで待機。within_g 指定時は |value| ≤ within_g も条件。"""
        deadline = time.monotonic() + timeout_ms / 1000
        while time.monotonic() < deadline:
            r = self.get_latest()
            if r and r.stable and not r.overload:
                if within_g is None or abs(r.value_g) <= within_g:
                    return r
            time.sleep(0.05)
        return None

    def wait_zero(self, timeout_ms: int = 3000,
                  within_g: float = 0.5) -> ScaleReading | None:
        """0 ±within_g かつ ST になるまで待機 (風袋完了確認用)。"""
        return self.wait_stable(timeout_ms=timeout_ms, within_g=within_g)

    # ── 内部ループ ────────────────────────────────────────────

    def _read_loop(self):
        """10Hz で ?WT をポーリング。pending_cmd があれば先に送信して応答を待つ。"""
        import serial
        while not self._stop_event.is_set():
            loop_start = time.monotonic()

            with self._read_lock:
                ser = self._serial
            if ser is None:
                break

            # 手動コマンドが入っていれば先に処理
            pending = self._pending_cmd
            if pending is not None:
                cmd, label = pending
                try:
                    # バッファに残っている ?WT 応答を完全に捨ててから送信
                    ser.reset_input_buffer()
                    time.sleep(0.05)
                    ser.reset_input_buffer()
                    ser.write(f"{cmd}\r\n".encode("ascii"))
                    # 応答を最大 1.5 秒間、複数行読んで ACK か EC を探す
                    result: str = ""
                    deadline = time.monotonic() + 1.5
                    while time.monotonic() < deadline:
                        raw = ser.readline()
                        if not raw:
                            continue
                        stripped = raw.strip()
                        if stripped == b"\x06":
                            result = "ACK"
                            break
                        text = stripped.decode("ascii", errors="ignore")
                        # ?WT の残り応答 (ST,+...) は読み飛ばす
                        if text[:2] in ("ST", "US", "OL", "UL", "TR"):
                            continue
                        # EC,... エラーコードや他の応答
                        if text:
                            result = text
                            break
                    self._cmd_result = result
                    log.info("秤コマンド %s → %s", label, result or "(無応答)")
                except Exception as e:
                    log.warning("秤コマンド送信エラー (%s): %s", label, e)
                    self._cmd_result = None
                finally:
                    self._pending_cmd = None
                    self._cmd_event.set()
                time.sleep(max(0, POLL_INTERVAL_S - (time.monotonic() - loop_start)))
                continue

            # 通常ポーリング: ?WT\r\n で重量要求
            try:
                ser.write(b"?WT\r\n")
                raw = ser.readline()
                if raw:
                    reading = self._parse(raw.decode("ascii", errors="ignore"))
                    if reading:
                        with self._read_lock:
                            self._latest = reading
            except serial.SerialException as e:
                log.warning("秤シリアルエラー: %s", e)
                with self._read_lock:
                    self._connected = False
                    self._latest = None
                break
            except Exception as e:
                log.warning("秤読み取りエラー: %s", e)
                time.sleep(0.1)

            time.sleep(max(0, POLL_INTERVAL_S - (time.monotonic() - loop_start)))

    @staticmethod
    def _parse(raw: str) -> ScaleReading | None:
        """A&D HC-6Ki 一般機器用フォーマット (f-06-03=2) をパース。
        ST,+0000.001 kg    安定 (単位は kg または g)
        US,+0000.001 kg    不安定
        OL,+9999999   kg   計量オーバー
        UL,-99999     kg   計量アンダー
        TR,...             風袋値 (stable=True として扱う)
        単位が kg のときは 1000 倍して g に換算する。
        """
        if not raw:
            return None
        line = raw.strip()
        if len(line) < 6 or line[2] != ",":
            return None
        status = line[0:2]
        rest = line[3:]
        if status == "OL":
            return ScaleReading(value_g=0.0, stable=False, overload=True, raw=line)
        if status not in ("ST", "US", "UL", "TR"):
            return None
        if not rest or rest[0] not in ("+", "-"):
            return None
        # 数値フィールドと単位に分割
        num_str = rest[0] + rest[1:9].strip()
        unit = rest[9:].strip().lower()
        try:
            value = float(num_str)
        except ValueError:
            return None
        if unit == "kg":
            value_g = value * 1000.0
        elif unit == "g":
            value_g = value
        else:
            # 単位不明は g 扱い
            value_g = value
        stable = status in ("ST", "TR")
        return ScaleReading(value_g=value_g, stable=stable, overload=False, raw=line)


scale = ScaleManager()
