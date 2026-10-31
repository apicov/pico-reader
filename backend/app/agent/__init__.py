"""The chat agent's tools: fixed functions with typed parameters (never free SQL), each answering for the signed-in
reader only, with compact JSON results. Tools marked `changes` don't run when the model calls them: the chat proposes
them, and they run only after the reader confirms (routes/chat.py).

registry.py: what a tool gets and is; the tools by topic (library, stats, community, notes, changes); catalog.py: how
the model sees them, and running one."""

from app.agent.catalog import TOOLS, run
from app.agent.registry import Context, Tool, resolve_book

__all__ = ["TOOLS", "Context", "Tool", "resolve_book", "run"]
