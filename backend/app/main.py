from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth import get_current_membership
from .config import settings
from .routers import admin, datasets, me
from .routers import variables, groups, models as models_router, analysis as analysis_router, predict as predict_router


def create_app() -> FastAPI:
    app = FastAPI(title="Aion API", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    tenant_dependency = [Depends(get_current_membership)]  # belt-and-suspenders: every tenant route needs a valid membership
    app.include_router(datasets.router, prefix="/datasets", tags=["datasets"], dependencies=tenant_dependency)
    app.include_router(variables.router, prefix="/variables", tags=["variables"], dependencies=tenant_dependency)
    app.include_router(groups.router, prefix="/groups", tags=["groups"], dependencies=tenant_dependency)
    app.include_router(models_router.router, prefix="/models", tags=["models"], dependencies=tenant_dependency)
    app.include_router(analysis_router.router, prefix="/analysis", tags=["analysis"], dependencies=tenant_dependency)
    app.include_router(predict_router.router, prefix="/predict", tags=["predict"], dependencies=tenant_dependency)
    app.include_router(admin.router, prefix="/admin", tags=["admin"])
    app.include_router(me.router, prefix="/me", tags=["me"])

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return app


app = create_app()
