import logging

from fastapi import Depends, FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .auth import get_current_membership
from .config import settings
from .routers import admin, datasets, me
from .routers import variables, groups, models as models_router, analysis as analysis_router, predict as predict_router
from .routers import economics as economics_router

logger = logging.getLogger("uvicorn.error")


def create_app() -> FastAPI:
    app = FastAPI(title="Aion API", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.allowed_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Starlette's ServerErrorMiddleware (which builds the default 500 response for an
    # unhandled exception) sits above CORSMiddleware in the stack, so that default 500
    # never gets CORS headers — the browser blocks it from JS and reports a generic
    # "Failed to fetch" instead of the real status/error. Catching it here routes the
    # response back through CORSMiddleware normally.
    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        logger.exception("Unhandled exception on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

    tenant_dependency = [Depends(get_current_membership)]  # belt-and-suspenders: every tenant route needs a valid membership
    app.include_router(datasets.router, prefix="/datasets", tags=["datasets"], dependencies=tenant_dependency)
    app.include_router(variables.router, prefix="/variables", tags=["variables"], dependencies=tenant_dependency)
    app.include_router(groups.router, prefix="/groups", tags=["groups"], dependencies=tenant_dependency)
    app.include_router(models_router.router, prefix="/models", tags=["models"], dependencies=tenant_dependency)
    app.include_router(analysis_router.router, prefix="/analysis", tags=["analysis"], dependencies=tenant_dependency)
    app.include_router(predict_router.router, prefix="/predict", tags=["predict"], dependencies=tenant_dependency)
    app.include_router(economics_router.router, prefix="/economics", tags=["economics"], dependencies=tenant_dependency)
    app.include_router(admin.router, prefix="/admin", tags=["admin"])
    app.include_router(me.router, prefix="/me", tags=["me"])

    @app.get("/health")
    def health():
        return {"status": "ok"}

    return app


app = create_app()
