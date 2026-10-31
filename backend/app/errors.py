"""What the app's own code raises when a request can't be done; main.py turns each into its HTTP status, so services
and the agent's tools don't depend on FastAPI (the agent reports the message to the model)."""


class DomainError(Exception):
    status = 400


class NotFound(DomainError):
    status = 404


class Forbidden(DomainError):
    status = 403


class Conflict(DomainError):
    status = 409


class Invalid(DomainError):
    status = 422
