from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .db import init_db
from .routers import datasets
from .routers import variables, groups, models as models_router, analysis as analysis_router, predict as predict_router


def create_app() -> FastAPI:
    app = FastAPI(title="Aion API", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # tighten in production
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(datasets.router, prefix="/datasets", tags=["datasets"])
    app.include_router(variables.router, prefix="/variables", tags=["variables"])
    app.include_router(groups.router, prefix="/groups", tags=["groups"])
    app.include_router(models_router.router, prefix="/models", tags=["models"])
    app.include_router(analysis_router.router, prefix="/analysis", tags=["analysis"])
    app.include_router(predict_router.router, prefix="/predict", tags=["predict"])

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return app


app = create_app()

@app.on_event("startup")
def on_startup():
    init_db()
