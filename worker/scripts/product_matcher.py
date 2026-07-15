"""In-memory OpenCLIP reference matcher used only by temporary Colab jobs."""
from __future__ import annotations
import io, urllib.request
import numpy as np
import torch
from PIL import Image


class ProductMatcher:
    def __init__(self, references: list[dict], threshold: float = 0.80):
        import open_clip
        self.threshold = threshold
        self.device = "cuda" if torch.cuda.is_available() else "cpu"
        self.model, _, self.preprocess = open_clip.create_model_and_transforms("ViT-B-32", pretrained="laion2b_s34b_b79k")
        self.model = self.model.to(self.device).eval(); self.vectors: list[tuple[str, torch.Tensor]] = []
        with torch.inference_mode():
            for product in references:
                for url in product.get("urls", []):
                    with urllib.request.urlopen(url, timeout=90) as response: image = Image.open(io.BytesIO(response.read())).convert("RGB")
                    vector = self.model.encode_image(self.preprocess(image).unsqueeze(0).to(self.device))
                    vector = vector / vector.norm(dim=-1, keepdim=True)
                    self.vectors.append((product["class_name"], vector))

    def match(self, crop: Image.Image) -> tuple[str | None, float]:
        if not self.vectors: return None, 0.0
        with torch.inference_mode():
            query = self.model.encode_image(self.preprocess(crop.convert("RGB")).unsqueeze(0).to(self.device))
            query = query / query.norm(dim=-1, keepdim=True)
            best_name, best_score = None, -1.0
            for name, vector in self.vectors:
                score = float((query @ vector.T).item())
                if score > best_score: best_name, best_score = name, score
        return (best_name if best_score >= self.threshold else None), best_score
