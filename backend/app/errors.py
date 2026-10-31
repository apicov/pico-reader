"""What the app's own code raises when a request can't be done; main.py turns each into its HTTP status, so services
and the agent's tools don't depend on FastAPI (the agent reports the message to the model)."""


class DomainError(Exception):
    status = 400

    def __init__(self, detail: str | dict = ""):
        super().__init__(detail)
        self.detail = detail  # the response's "detail": a message, or a dict when the client needs more (what's missing)


class NotFound(DomainError):
    status = 404


class Forbidden(DomainError):
    status = 403


class Conflict(DomainError):
    status = 409


class Invalid(DomainError):
    status = 422


class Unavailable(DomainError):
    """Something the server depends on (storage) didn't answer."""
    status = 503
