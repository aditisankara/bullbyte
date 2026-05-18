"""Structured JSON logging for the ML sidecar.

Every log record automatically includes `service: "ml-sidecar"`.
Log format: { level, message, service, timestamp, <extra fields> }
"""

import logging
import os

from pythonjsonlogger.json import JsonFormatter


class _ServiceJsonFormatter(JsonFormatter):
    """Adds `service` and renames stdlib fields to match the project schema."""

    def add_fields(self, log_record: dict, record: logging.LogRecord, message_dict: dict) -> None:
        super().add_fields(log_record, record, message_dict)
        log_record["service"] = "ml-sidecar"
        log_record.setdefault("level", record.levelname.lower())
        log_record.pop("levelname", None)
        log_record.pop("name", None)


def get_logger(name: str) -> logging.Logger:
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(_ServiceJsonFormatter())
        logger.addHandler(handler)
    level = os.environ.get("LOG_LEVEL", "info").upper()
    logger.setLevel(getattr(logging, level, logging.INFO))
    return logger
