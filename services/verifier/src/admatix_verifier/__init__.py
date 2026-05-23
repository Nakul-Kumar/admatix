"""AdMatix independent verification engine.

Public entry points live in `admatix_verifier.app` (the FastAPI app),
`admatix_verifier.models` (the Pydantic request/response models), and the
`admatix_verifier.methods` package (one module per verification method).
"""

from __future__ import annotations

__version__ = "0.1.0"

__all__ = ["__version__"]
