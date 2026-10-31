"""Text embeddings with multilingual-e5-small (int8 ONNX, ~120 MB): small enough for the 2 GB server, which
embeds questions with the same model (backend/app/embed.py is the same code; keep the two equal).

e5 expects "passage: " before indexed text and "query: " before questions.
"""

import hashlib
import os
from functools import lru_cache
from pathlib import Path

import numpy as np

MODEL = "Xenova/multilingual-e5-small"
REVISION = "761b726dd34fb83930e26aab4e9ac3899aa1fa78"  # a fixed commit, not main: the vectors must stay comparable
# local name → (file in the model's repository, its sha256)
FILES = {
    "model.onnx": ("onnx/model_quantized.onnx", "f80102d3f2a1229f387d3c81909990d8945513e347b0eab049f7de3c6f98c193"),
    "tokenizer.json": ("tokenizer.json", "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39"),
}
DIMENSIONS = 384
MAX_TOKENS = 512


def model_dir() -> Path:
    base = Path(os.environ.get("PICO_READER_MODELS", Path.home() / ".cache" / "pico-reader" / "models"))
    return base / MODEL.replace("/", "--")


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def _download() -> Path:
    import urllib.request

    folder = model_dir()
    folder.mkdir(parents=True, exist_ok=True)
    for name, (remote, sha256) in FILES.items():
        target = folder / name
        if not target.exists():
            print(f"  downloading {MODEL} {remote}…")
            tmp = target.with_suffix(".part")
            urllib.request.urlretrieve(f"https://huggingface.co/{MODEL}/resolve/{REVISION}/{remote}", tmp)
            if _sha256(tmp) != sha256:
                tmp.unlink()
                raise RuntimeError(f"{MODEL} {remote} isn't the file expected (sha256 differs): not used")
            tmp.rename(target)
    return folder


@lru_cache
def _model():
    import onnxruntime
    from tokenizers import Tokenizer

    folder = _download()
    tokenizer = Tokenizer.from_file(str(folder / "tokenizer.json"))
    tokenizer.enable_truncation(MAX_TOKENS)
    tokenizer.enable_padding()
    options = onnxruntime.SessionOptions()
    options.intra_op_num_threads = int(os.environ.get("EMBED_THREADS", "0")) or 0
    session = onnxruntime.InferenceSession(str(folder / "model.onnx"), options, providers=["CPUExecutionProvider"])
    return tokenizer, session


def embed(texts: list[str], kind: str = "passage", batch: int = 32) -> np.ndarray:
    """L2-normalised vectors, one row per text; kind is "passage" (indexing) or "query" (questions)."""
    tokenizer, session = _model()
    inputs = {i.name for i in session.get_inputs()}
    out = []
    for start in range(0, len(texts), batch):
        enc = tokenizer.encode_batch([f"{kind}: {t}" for t in texts[start:start + batch]])
        ids = np.array([e.ids for e in enc], dtype=np.int64)
        mask = np.array([e.attention_mask for e in enc], dtype=np.int64)
        feed = {"input_ids": ids, "attention_mask": mask}
        if "token_type_ids" in inputs:
            feed["token_type_ids"] = np.zeros_like(ids)
        hidden = session.run(None, feed)[0]  # (batch, tokens, 384)
        summed = (hidden * mask[..., None]).sum(axis=1)
        vectors = summed / np.maximum(mask.sum(axis=1, keepdims=True), 1)
        out.append(vectors / np.linalg.norm(vectors, axis=1, keepdims=True))
    return np.vstack(out) if out else np.zeros((0, DIMENSIONS), dtype=np.float32)
