#!/usr/bin/env python
"""Dev runner — wraps uvicorn so you can start with: python manage.py"""
import sys
import uvicorn


def main() -> None:
    reload = "--no-reload" not in sys.argv
    port = int(__import__("os").getenv("PORT", "8011"))
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=reload)


if __name__ == "__main__":
    main()
