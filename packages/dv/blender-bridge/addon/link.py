"""A small WebSocket client (RFC 6455) for the link to the harness, with the standard library only, because Blender's
Python ships no WebSocket library. It is free of bpy: one thread reads frames, one thread writes queued frames, and the
caller's callbacks run on the reading thread, so a Blender caller hands messages to the main thread itself.

It covers what the link needs: the opening handshake with an Authorization header, masked text and binary frames out,
text and binary messages in (with continuation frames), ping/pong, and close.
"""

import base64
import hashlib
import os
import queue
import socket
import ssl
import struct
import threading

GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
OP_CONT, OP_TEXT, OP_BINARY, OP_CLOSE, OP_PING, OP_PONG = 0x0, 0x1, 0x2, 0x8, 0x9, 0xA


class HandshakeError(Exception):
    """The harness refused the link; ``status`` is the HTTP status code (401: wrong token)."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def encode_frame(opcode, payload, mask_key=None):
    """One masked client frame (FIN set). ``mask_key`` is for tests; a random key is drawn otherwise."""
    payload = bytes(payload)
    length = len(payload)
    head = bytearray([0x80 | opcode])
    if length < 126:
        head.append(0x80 | length)
    elif length < 65536:
        head.append(0x80 | 126)
        head += struct.pack(">H", length)
    else:
        head.append(0x80 | 127)
        head += struct.pack(">Q", length)
    key = mask_key if mask_key is not None else os.urandom(4)
    head += key
    if length == 0:
        return bytes(head)
    # XOR with the repeated key, done on whole integers for speed.
    repeated = (key * (length // 4 + 1))[:length]
    masked = (int.from_bytes(payload, "big") ^ int.from_bytes(repeated, "big")).to_bytes(length, "big")
    return bytes(head) + masked


class Link:
    """One WebSocket connection to ``ws(s)://host:port/path``.

    ``on_message(kind, data)`` receives ``"text"`` with a str or ``"binary"`` with bytes; ``on_close(code, reason)``
    runs once when the connection ends for any reason, with code 1006 when it broke without a close frame.
    """

    def __init__(self, host, port, path, token, secure, on_message, on_close, timeout=10.0):
        self.host, self.port, self.path, self.token, self.secure = host, port, path, token, secure
        self.on_message, self.on_close = on_message, on_close
        self.timeout = timeout
        self._sock = None
        self._outbox = queue.Queue()
        self._closed = threading.Event()
        self._close_lock = threading.Lock()
        self._close_reported = False

    def connect(self):
        """Open the connection and do the handshake on the calling thread, then start the reader and writer threads.

        Raises HandshakeError when the harness answers with another status than 101, and OSError when it is unreachable.
        """
        raw = socket.create_connection((self.host, self.port), timeout=self.timeout)
        sock = ssl.create_default_context().wrap_socket(raw, server_hostname=self.host) if self.secure else raw
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        host = self.host if (self.port in (80, 443)) else "%s:%d" % (self.host, self.port)
        request = (
            "GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            "Sec-WebSocket-Key: %s\r\nSec-WebSocket-Version: 13\r\nAuthorization: Bearer %s\r\n\r\n"
        ) % (self.path, host, key, self.token)
        sock.sendall(request.encode("ascii"))
        buffer = b""
        while b"\r\n\r\n" not in buffer:
            data = sock.recv(4096)
            if not data:
                sock.close()
                raise HandshakeError(0, "The harness closed the connection during the handshake.")
            buffer += data
        head, _, rest = buffer.partition(b"\r\n\r\n")
        lines = head.decode("latin-1").split("\r\n")
        try:
            status = int(lines[0].split(" ")[1])
        except (IndexError, ValueError):
            status = 0
        headers = {}
        for line in lines[1:]:
            name, _, value = line.partition(":")
            headers[name.strip().lower()] = value.strip()
        expected = base64.b64encode(hashlib.sha1((key + GUID).encode("ascii")).digest()).decode("ascii")
        if status != 101 or headers.get("sec-websocket-accept") != expected:
            sock.close()
            raise HandshakeError(status, "The harness refused the connection (HTTP %d)." % status)
        sock.settimeout(None)
        self._sock = sock
        threading.Thread(target=self._read, args=(rest,), name="dreamverse-link-read", daemon=True).start()
        threading.Thread(target=self._write, name="dreamverse-link-write", daemon=True).start()

    def send_text(self, text):
        """Queue one text message."""
        self._outbox.put(encode_frame(OP_TEXT, text.encode("utf-8")))

    def send_binary(self, data):
        """Queue one binary message."""
        self._outbox.put(encode_frame(OP_BINARY, data))

    def close(self, code=1000, reason=""):
        """Send a close frame and end the connection."""
        if self._sock is None or self._closed.is_set():
            return
        self._outbox.put(encode_frame(OP_CLOSE, struct.pack(">H", code) + reason.encode("utf-8")[:120]))
        self._outbox.put(None)

    @property
    def open(self):
        return self._sock is not None and not self._closed.is_set()

    def _finish(self, code, reason):
        """End the connection and call ``on_close`` once, on whichever thread sees the end first."""
        with self._close_lock:
            if self._close_reported:
                return
            self._close_reported = True
        self._closed.set()
        self._outbox.put(None)
        try:
            self._sock.close()
        except OSError:
            pass
        self.on_close(code, reason)

    def _write(self):
        """Send queued frames on the writer thread until the close; a requested close first waits up to 2 s for the
        harness's close frame."""
        while True:
            frame = self._outbox.get()
            if frame is None or self._closed.is_set():
                if frame is None and not self._closed.is_set():
                    # A close was requested: give the reader a moment to see the harness's close frame.
                    self._closed.wait(2.0)
                    self._finish(1000, "closed by Blender")
                return
            try:
                self._sock.sendall(frame)
            except OSError as error:
                self._finish(1006, str(error))
                return

    def _read(self, pending):
        """Read frames on the reader thread, starting with the handshake's leftover bytes ``pending``: answer pings and
        the close frame, and pass each whole text or binary message to ``on_message``."""
        buffer = bytearray(pending)
        message_op, parts = None, []

        def need(count):
            while len(buffer) < count:
                data = self._sock.recv(65536)
                if not data:
                    raise ConnectionError("connection closed")
                buffer.extend(data)

        try:
            while True:
                need(2)
                first, second = buffer[0], buffer[1]
                opcode, fin, length, offset = first & 0x0F, bool(first & 0x80), second & 0x7F, 2
                if length == 126:
                    need(4)
                    length, offset = struct.unpack(">H", bytes(buffer[2:4]))[0], 4
                elif length == 127:
                    need(10)
                    length, offset = struct.unpack(">Q", bytes(buffer[2:10]))[0], 10
                masked = bool(second & 0x80)
                if masked:
                    offset += 4
                need(offset + length)
                payload = bytes(buffer[offset:offset + length])
                if masked:
                    key = bytes(buffer[offset - 4:offset])
                    payload = bytes(b ^ key[i % 4] for i, b in enumerate(payload))
                del buffer[:offset + length]
                if opcode == OP_PING:
                    self._outbox.put(encode_frame(OP_PONG, payload))
                elif opcode == OP_PONG:
                    pass
                elif opcode == OP_CLOSE:
                    code = struct.unpack(">H", payload[:2])[0] if len(payload) >= 2 else 1005
                    reason = payload[2:].decode("utf-8", "replace")
                    try:
                        self._sock.sendall(encode_frame(OP_CLOSE, payload[:2]))
                    except OSError:
                        pass
                    self._finish(code, reason)
                    return
                else:
                    if opcode != OP_CONT:
                        message_op, parts = opcode, []
                    parts.append(payload)
                    if fin and message_op is not None:
                        data = b"".join(parts)
                        if message_op == OP_TEXT:
                            self.on_message("text", data.decode("utf-8"))
                        elif message_op == OP_BINARY:
                            self.on_message("binary", data)
                        message_op, parts = None, []
        except (OSError, ConnectionError) as error:
            self._finish(1006, str(error))
