"""Production entrypoint for NER Smart Logistics.

The legacy main.py and live_alerts.py files are preserved unchanged.
New functionality is mounted additively through ner_services.py and
access_control.py.
"""
from main import app
from ner_services import router as additional_router
from access_control import router as role_router

app.include_router(additional_router)
app.include_router(role_router)
