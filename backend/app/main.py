import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app import groq_client
from app.config import get_settings
from app.errors import DomainError
from app.routes import (
    admin,
    annotations,
    auth,
    books,
    categories,
    chat,
    community,
    computer,
    events,
    learning,
    library,
    notes,
    progress,
    search,
    settings,
    shelf,
    stats,
    translate,
    vocabulary,
)

logging.basicConfig(level=logging.INFO)

app = FastAPI(title="Pico Reader API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origin_list,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["ETag"],
)


@app.exception_handler(DomainError)
def domain_error(_: Request, e: DomainError):
    return JSONResponse({"detail": str(e)}, status_code=e.status)


@app.exception_handler(groq_client.GroqError)
def llm_error(_: Request, e: groq_client.GroqError):
    """The AI couldn't answer: its status (502 unreachable, 503 not set up, 429 rate limit) and why"""
    return JSONResponse({"detail": str(e)}, status_code=e.status)
app.include_router(auth.router)
app.include_router(library.router)
app.include_router(admin.router)
app.include_router(books.router)
app.include_router(progress.router)
app.include_router(translate.router)
app.include_router(search.router)
app.include_router(vocabulary.router)
app.include_router(annotations.router)
app.include_router(chat.router)
app.include_router(events.router)
app.include_router(stats.router)
app.include_router(settings.router)
app.include_router(learning.router)
app.include_router(shelf.router)
app.include_router(community.router)
app.include_router(categories.router)
app.include_router(notes.router)
app.include_router(computer.router)


@app.get("/health")
def health():
    return {"status": "ok"}
