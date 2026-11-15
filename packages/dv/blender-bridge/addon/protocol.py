"""Pure helpers of the DreamVerse add-on, free of bpy so they run under plain Python in tests.

- parse_connection: the connection string the Blender tab of the harness shows, ``<harness origin>#<pairing token>``.
- encode_binary: the binary message framing of the link (4-byte big-endian header length, JSON header, payload).
- encode_png: an 8-bit RGB or RGBA PNG from top-down rows, with zlib only.
"""

import json
import struct
import zlib
from urllib.parse import urlsplit

LINK_PATH = "/dv/blender/ws"


class ConnectionStringError(ValueError):
    """The connection string is not ``<http or https origin>#<token>``."""


def parse_connection(text):
    """Split a connection string into the link's WebSocket URL parts and the pairing token.

    Returns a dict with ``secure`` (bool), ``host``, ``port`` (int), ``path`` and ``token``.
    """
    text = (text or "").strip()
    origin, sep, token = text.partition("#")
    if not sep or not token.strip():
        raise ConnectionStringError("Paste the whole connection string from the Blender tab, including the part after #.")
    parts = urlsplit(origin.strip())
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise ConnectionStringError("The connection string must start with the harness address, such as http://127.0.0.1:18094.")
    secure = parts.scheme == "https"
    try:
        port = parts.port or (443 if secure else 80)
    except ValueError as error:
        raise ConnectionStringError("The port in the connection string is not a number.") from error
    prefix = parts.path.rstrip("/")
    return {"secure": secure, "host": parts.hostname, "port": port, "path": prefix + LINK_PATH, "token": token.strip()}


def is_local_host(host):
    """Whether a host name is this machine, which Blender's Online Access setting does not govern."""
    return host in ("127.0.0.1", "localhost", "::1")


def encode_binary(header, payload):
    """One binary link message: the header length, the JSON header and the payload bytes."""
    head = json.dumps(header, separators=(",", ":")).encode("utf-8")
    return struct.pack(">I", len(head)) + head + bytes(payload)


def drop_alpha(rows):
    """RGB bytes from RGBA bytes: every fourth byte, the alpha, removed."""
    data = bytes(rows)
    if len(data) % 4 != 0:
        raise ValueError("RGBA rows hold a multiple of 4 bytes")
    rgb = bytearray(len(data) // 4 * 3)
    rgb[0::3] = data[0::4]
    rgb[1::3] = data[1::4]
    rgb[2::3] = data[2::4]
    return bytes(rgb)


def encode_png(rows, width, height, channels):
    """An 8-bit PNG from ``rows``: ``height`` top-down rows of ``width * channels`` bytes each (bytes-like)."""
    if channels not in (3, 4):
        raise ValueError("channels must be 3 or 4")
    stride = width * channels
    data = bytes(rows)
    if len(data) != stride * height:
        raise ValueError("rows do not hold width * height * channels bytes")
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        raw += data[y * stride:(y + 1) * stride]

    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 6 if channels == 4 else 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(bytes(raw), 6)) + chunk(b"IEND", b"")
