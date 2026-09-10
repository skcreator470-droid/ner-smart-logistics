import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from fastapi.middleware.cors import CORSMiddleware

from main import app
from ner_services import router as additional_router
from access_control import router as role_router
from advanced_intelligence import router as intelligence_router


# Additive CORS wrapper.
# Legacy backend files remain unchanged.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_origins=[
        "https://skcreator470-droid.github.io",
        "https://r470-droid.github.io",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(additional_router)
app.include_router(role_router)
app.include_router(intelligence_router)
