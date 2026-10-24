import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routes import admin, annotations, auth, chat, library, progress, search, translate, vocabulary

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Pico Reader API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["ETag"],
)
app.include_router(auth.router)
app.include_router(library.router)
app.include_router(admin.router)
app.include_router(progress.router)
app.include_router(translate.router)
app.include_router(search.router)
app.include_router(vocabulary.router)
app.include_router(annotations.router)
app.include_router(chat.router)


@app.get("/health")
def health():
    return {"status": "ok"}
