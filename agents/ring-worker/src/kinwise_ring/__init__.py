"""Kinwise Ring worker.

Turns Ring Partner API activity (event history, webhooks, WHEP live view) into
neutral, privacy-safe visitor events and sends them, HMAC-signed, to the Kinwise hub.
Frames are analysed in memory and discarded; only presence, count, a carried object
and one neutral sentence ever leave this process.
"""

__version__ = "0.1.0"
USER_AGENT = "kinwise-ring/0.1"
