import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))
import ditto_server


class TestDittoServerHelpers(unittest.TestCase):
    def test_emotion_mapping(self):
        self.assertEqual(ditto_server.map_emotion_to_ditto("happy"), 3)
        self.assertEqual(ditto_server.map_emotion_to_ditto("[Surprised]"), 6)
        self.assertEqual(ditto_server.map_emotion_to_ditto("neutral"), 4)
        self.assertEqual(ditto_server.map_emotion_to_ditto("relaxed"), [3, 4])
        self.assertEqual(ditto_server.map_emotion_to_ditto("shy"), [3, 4])
        self.assertEqual(ditto_server.map_emotion_to_ditto("unknown"), 4)
        self.assertEqual(ditto_server.map_emotion_to_ditto(None), [3, 4])

    def test_resolve_ditto_backend_auto_prefers_trt_on_ampere(self):
        with tempfile.TemporaryDirectory() as td:
            ckpt = Path(td)
            (ckpt / "ditto_cfg").mkdir()
            (ckpt / "ditto_pytorch").mkdir()
            (ckpt / "ditto_trt_Ampere_Plus").mkdir()
            (ckpt / "ditto_cfg" / "v0.4_hubert_cfg_pytorch.pkl").write_bytes(b"p")
            (ckpt / "ditto_cfg" / "v0.4_hubert_cfg_trt.pkl").write_bytes(b"t")
            (ckpt / "ditto_trt_Ampere_Plus" / "decoder_fp16.engine").write_bytes(b"e")

            # Ampere GPU (8, 6) + TensorRT -> picks Ampere TRT
            name, root, cfg = ditto_server.resolve_ditto_backend(
                ckpt, backend="auto", compute_capability=(8, 6), has_tensorrt=True
            )
            self.assertEqual(name, "ditto-trt-ampere")
            self.assertEqual(root, ckpt / "ditto_trt_Ampere_Plus")
            self.assertEqual(cfg.name, "v0.4_hubert_cfg_trt.pkl")

            # Turing T4 (7, 5) without custom TRT -> falls back cleanly to PyTorch
            name_t4, root_t4, cfg_t4 = ditto_server.resolve_ditto_backend(
                ckpt, backend="auto", compute_capability=(7, 5), has_tensorrt=True
            )
            self.assertEqual(name_t4, "ditto-pytorch")
            self.assertEqual(root_t4, ckpt / "ditto_pytorch")
            self.assertEqual(cfg_t4.name, "v0.4_hubert_cfg_pytorch.pkl")

            # Custom TRT built for T4 -> prefers custom TRT
            (ckpt / "ditto_trt_custom").mkdir()
            (ckpt / "ditto_trt_custom" / "decoder_fp16.engine").write_bytes(b"e")
            name_c, root_c, _ = ditto_server.resolve_ditto_backend(
                ckpt, backend="auto", compute_capability=(7, 5), has_tensorrt=True
            )
            self.assertEqual(name_c, "ditto-trt-custom")
            self.assertEqual(root_c, ckpt / "ditto_trt_custom")

    def test_wrap_avatar_registrar_caches_source_info(self):
        fake_sdk = mock.Mock()
        call_count = 0

        def fake_reg(source_path, **kwargs):
            nonlocal call_count
            call_count += 1
            return {"x_s_info_lst": [1, 2], "img_rgb_lst": ["frame0"]}

        fake_sdk.avatar_registrar = fake_reg
        cache = ditto_server.wrap_avatar_registrar_with_cache(fake_sdk)

        res1 = fake_sdk.avatar_registrar("/tmp/nara.jpg", max_dim=1024, crop_scale=2.3)
        res2 = fake_sdk.avatar_registrar("/tmp/nara.jpg", max_dim=1024, crop_scale=2.3)

        self.assertEqual(call_count, 1)
        self.assertEqual(len(cache), 1)
        self.assertEqual(res1["x_s_info_lst"], [1, 2])
        # Mutating returned list must not corrupt the cached copy
        res1["x_s_info_lst"].append(99)
        self.assertEqual(res2["x_s_info_lst"], [1, 2])


if __name__ == "__main__":
    unittest.main()
