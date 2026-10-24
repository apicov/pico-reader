"""The category tree (app/categories.py): everyone reads it; admins add, rename, move, approve, merge and delete."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import categories as cats
from app.auth import Reader, get_current_admin, get_current_reader
from app.db import get_db

router = APIRouter(prefix="/api", tags=["categories"])


class CategoryNew(BaseModel):
    parent_id: int | None = None
    name: str = Field(min_length=1, max_length=60)


class CategoryEdit(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    parent_id: int | None = None
    move: bool = False  # parent_id given (None = to the top level)
    status: Literal["approved"] | None = None


class MergeIn(BaseModel):
    into: int


@router.get("/categories")
def tree(_: Reader = Depends(get_current_reader), db: Session = Depends(get_db)):
    return cats.tree(db)


@router.post("/admin/categories", status_code=201)
def add(body: CategoryNew, _: Reader = Depends(get_current_admin), db: Session = Depends(get_db)):
    node = cats.add(db, body.parent_id, body.name)
    db.commit()
    return node


@router.put("/admin/categories/{category_id}")
def edit(category_id: int, body: CategoryEdit, _: Reader = Depends(get_current_admin), db: Session = Depends(get_db)):
    nodes = {n["id"]: n for n in cats.tree(db)}
    node = nodes.get(category_id)
    if node is None:
        raise HTTPException(404, "No such category")
    try:
        _apply(db, category_id, body, nodes, node)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "There is already a category with that name there")
    return next(n for n in cats.tree(db) if n["id"] == category_id)


def _apply(db: Session, category_id: int, body: CategoryEdit, nodes: dict, node: dict) -> None:
    if body.move:
        parent = nodes.get(body.parent_id) if body.parent_id is not None else None
        if body.parent_id is not None and parent is None:
            raise HTTPException(404, "No such parent")
        below = max((n["depth"] for n in nodes.values() if n["path"].startswith(node["path"] + cats.SEP)), default=node["depth"])
        cur = body.parent_id
        while cur is not None:
            if cur == category_id:
                raise HTTPException(422, "Can't move a category below itself")
            cur = nodes[cur]["parent_id"]
        if (parent["depth"] if parent else 0) + 1 + (below - node["depth"]) > cats.MAX_DEPTH:
            raise HTTPException(422, "Categories go 3 levels deep at most")
        db.execute(text("UPDATE categories SET parent_id = :p WHERE id = :id"), {"p": body.parent_id, "id": category_id})
    if body.name:
        db.execute(text("UPDATE categories SET name = :n, slug = :s WHERE id = :id"),
                   {"n": body.name.strip(), "s": cats.slug(body.name), "id": category_id})
    if body.status:
        db.execute(text("UPDATE categories SET status = 'approved' WHERE id = :id"), {"id": category_id})


@router.post("/admin/categories/{category_id}/merge", status_code=204)
def merge(category_id: int, body: MergeIn, _: Reader = Depends(get_current_admin), db: Session = Depends(get_db)):
    cats.merge(db, category_id, body.into)


@router.delete("/admin/categories/{category_id}", status_code=204)
def delete(category_id: int, _: Reader = Depends(get_current_admin), db: Session = Depends(get_db)):
    node = next((n for n in cats.tree(db) if n["id"] == category_id), None)
    if node is None:
        raise HTTPException(404, "No such category")
    if node["books"] or db.execute(text("SELECT 1 FROM categories WHERE parent_id = :id"), {"id": category_id}).fetchone():
        raise HTTPException(409, "Only an empty category can be deleted: merge it instead")
    db.execute(text("DELETE FROM categories WHERE id = :id"), {"id": category_id})
    db.commit()
