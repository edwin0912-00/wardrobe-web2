from __future__ import annotations

import importlib.util
import os
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


REPO_ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = REPO_ROOT / "scripts" / "operator-setup.py"
SPEC = importlib.util.spec_from_file_location("operator_setup", MODULE_PATH)
operator_setup = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(operator_setup)


class OperatorSetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.temp_root = Path(self.temp.name)
        self.repo = self.temp_root / "checkout"
        self.repo.mkdir()
        self.outside = self.temp_root / "private"
        self.config_path = self.outside / "operator-config.json"
        self.config = {
            "version": 1,
            "host_label": "wardrobe-host",
            "public_https_origin": "https://wardrobe.example",
            "runtime_root": str(self.outside / "runtime"),
            "codex_home": str(self.outside / "codex-home"),
            "fal_key": "fal-secret-value",
            "openrouter_api_key": "openrouter-secret-value",
            "video_reference_root": None,
            "site_port": 4173,
            "engine_port": 4176,
        }

    def tearDown(self):
        self.temp.cleanup()

    def test_config_is_written_atomically_with_private_permissions(self):
        operator_setup.save_config(self.config_path, self.config, self.repo)
        self.assertEqual(stat.S_IMODE(self.outside.stat().st_mode), 0o700)
        self.assertEqual(stat.S_IMODE(self.config_path.stat().st_mode), 0o600)
        self.assertEqual(
            operator_setup.load_config(self.config_path, self.repo),
            operator_setup.validate_config(self.config, self.repo),
        )
        self.assertEqual(list(self.outside.glob(".operator-config-*")), [])

    def test_invalid_ports_and_duplicate_ports_are_rejected(self):
        for value in (0, 65536, "eighty", True):
            with self.subTest(value=value), self.assertRaises(operator_setup.SetupError):
                operator_setup.validate_port(value, "Site port")
        with self.assertRaises(operator_setup.SetupError):
            operator_setup.validate_port("4173.5", "Site port")
        duplicate = dict(self.config, engine_port=4173)
        with self.assertRaisesRegex(operator_setup.SetupError, "must differ"):
            operator_setup.validate_config(duplicate, self.repo)

    def test_public_origin_must_be_https_host_only(self):
        self.assertEqual(operator_setup.validate_origin("https://wardrobe.example/"), "https://wardrobe.example")
        for value in (
            "http://wardrobe.example",
            "https://user:pass@wardrobe.example",
            "https://wardrobe.example/path",
            "https://wardrobe.example?debug=1",
            "https://wardrobe.example#section",
            "https://wardrobe.example:",
            "https://wardrobe.example:0",
        ):
            with self.subTest(value=value), self.assertRaises(operator_setup.SetupError):
                operator_setup.validate_origin(value)

    def test_private_paths_must_be_absolute_and_outside_checkout(self):
        for value in ("relative/path", str(self.repo / "runtime"), str(self.temp_root)):
            with self.subTest(value=value), self.assertRaises(operator_setup.SetupError):
                operator_setup._absolute_private_directory(value, "Private path", self.repo)
        accepted = operator_setup._absolute_private_directory(
            str(self.outside / "runtime"), "Private path", self.repo
        )
        self.assertEqual(accepted, str((self.outside / "runtime").resolve()))
        with self.assertRaisesRegex(operator_setup.SetupError, "separate from the repository"):
            operator_setup.load_config(self.repo / "operator-config.json", self.repo)
        with self.assertRaisesRegex(operator_setup.SetupError, "must be absolute"):
            operator_setup.validate_config_path("relative/operator-config.json", self.repo)

    def test_existing_configuration_blanks_preserve_values_and_decline_preserves_file(self):
        operator_setup.save_config(self.config_path, self.config, self.repo)
        original = self.config_path.read_bytes()
        answers = iter(["", "", "", "", "", "", "", "", "n"])
        configure = operator_setup.configure(
            self.config_path,
            self.repo,
            input_fn=lambda _prompt: next(answers),
            secret_fn=lambda _prompt: "",
        )
        self.assertEqual(configure, 0)
        self.assertEqual(self.config_path.read_bytes(), original)
        loaded = operator_setup.load_config(self.config_path, self.repo)
        self.assertEqual(loaded["fal_key"], "fal-secret-value")
        self.assertEqual(loaded["openrouter_api_key"], "openrouter-secret-value")

    def test_run_maps_private_json_environment_and_uses_verify_argv(self):
        captured = {}

        def fake_runner(args, **kwargs):
            captured["args"] = args
            captured.update(kwargs)
            return SimpleNamespace(returncode=0)

        config = operator_setup.validate_config(self.config, self.repo)
        result = operator_setup.run_product(
            self.repo,
            config,
            base_environment={
                "PATH": "/usr/bin",
                "FAL_KEY": "stale-shell-key",
                "OPENROUTER_API_KEY": "stale-shell-key",
                "WARDROBE_ALPHA_SITE_PORT": "4999",
                "ZEELY_RUNTIME_ROOT": "/stale/runtime",
                "ZEELY_GENERATION_PROVIDER": "codex-imagegen-test",
                "ZEELY_LOOK_IMAGE_ROUTE": "fast",
            },
            runner=fake_runner,
        )
        self.assertEqual(result, 0)
        self.assertEqual(captured["args"], ["./verify", "--run"])
        self.assertEqual(captured["cwd"], str(self.repo))
        self.assertEqual(captured["env"]["FAL_KEY"], "fal-secret-value")
        self.assertEqual(captured["env"]["OPENROUTER_API_KEY"], "openrouter-secret-value")
        self.assertEqual(captured["env"]["ZEELY_VLM_PROVIDER"], "openrouter")
        self.assertEqual(captured["env"]["ZEELY_GENERATION_PROVIDER"], "codex-primary")
        self.assertNotIn("ZEELY_LOOK_IMAGE_ROUTE", captured["env"])
        self.assertEqual(captured["env"]["CODEX_HOME"], config["codex_home"])
        self.assertEqual(captured["env"]["WARDROBE_ALPHA_RUNTIME_ROOT"], config["runtime_root"])
        self.assertEqual(captured["env"]["WARDROBE_ALPHA_SITE_PORT"], "4173")
        self.assertNotIn("ZEELY_RUNTIME_ROOT", captured["env"])
        self.assertNotIn("fal-secret-value", " ".join(captured["args"]))

    def test_check_report_redacts_keys_and_does_not_call_providers(self):
        operator_setup.save_config(self.config_path, self.config, self.repo)
        loaded = operator_setup.load_config(self.config_path, self.repo)
        auth_path = Path(loaded["codex_home"]) / "auth.json"
        auth_path.parent.mkdir(mode=0o700)
        auth_path.write_text("fixture only", encoding="utf-8")
        from contextlib import redirect_stdout
        from io import StringIO

        output = StringIO()
        with redirect_stdout(output):
            operator_setup.report_check(loaded)
        text = output.getvalue()
        self.assertIn("Codex auth file: present", text)
        self.assertIn("FAL credential: configured", text)
        self.assertNotIn("fal-secret-value", text)
        self.assertNotIn("openrouter-secret-value", text)

    def test_secret_prompt_refuses_non_tty_input(self):
        with patch.object(operator_setup.sys.stdin, "isatty", return_value=False):
            with self.assertRaisesRegex(operator_setup.SetupError, "masked input"):
                operator_setup.read_masked_secret("FAL_KEY: ")

    def test_setup_check_cli_uses_private_fixture_home_and_redacts_values(self):
        fixture_home = self.temp_root / "fixture-home"
        config_path = operator_setup.default_config_path(fixture_home, {})
        operator_setup.save_config(config_path, self.config, self.repo)
        environment = os.environ.copy()
        environment["HOME"] = str(fixture_home)
        environment.pop("FAL_KEY", None)
        environment.pop("OPENROUTER_API_KEY", None)
        environment["PYTHONDONTWRITEBYTECODE"] = "1"
        result = subprocess.run(
            [str(REPO_ROOT / "setup"), "--config", str(config_path), "--check"],
            cwd=REPO_ROOT,
            env=environment,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Configuration: valid", result.stdout)
        self.assertNotIn("fal-secret-value", result.stdout)
        self.assertNotIn("openrouter-secret-value", result.stdout)

    def test_cli_rejects_config_path_inside_checkout(self):
        config_path = REPO_ROOT / "private-operator-config.json"
        result = subprocess.run(
            [str(REPO_ROOT / "setup"), "--config", str(config_path), "--check"],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("separate from the repository checkout", result.stderr)
        self.assertFalse(config_path.exists())

    def test_run_configures_first_host_then_loads_saved_config_and_starts(self):
        def save_first_config(config_path, repo_root):
            operator_setup.save_config(config_path, self.config, repo_root)
            return 0

        with (
            patch.object(operator_setup, "default_config_path", return_value=self.config_path),
            patch.object(operator_setup, "configure", side_effect=save_first_config) as configure,
            patch.object(operator_setup, "report_check"),
            patch.object(operator_setup, "run_product", return_value=0) as run_product,
        ):
            self.assertEqual(operator_setup.main(["run"]), 0)
        configure.assert_called_once_with(self.config_path.parent.resolve() / self.config_path.name, REPO_ROOT)
        run_product.assert_called_once()
        self.assertEqual(run_product.call_args.args[1], operator_setup.validate_config(self.config, REPO_ROOT))

    def test_first_run_declining_to_save_aborts_without_starting_product(self):
        with (
            patch.object(operator_setup, "default_config_path", return_value=self.config_path),
            patch.object(operator_setup, "configure", return_value=0),
            patch.object(operator_setup, "run_product") as run_product,
        ):
            self.assertEqual(operator_setup.main(["run"]), 1)
        run_product.assert_not_called()

    def test_saved_config_run_does_not_reopen_questionnaire(self):
        operator_setup.save_config(self.config_path, self.config, REPO_ROOT)
        with (
            patch.object(operator_setup, "default_config_path", return_value=self.config_path),
            patch.object(operator_setup, "configure") as configure,
            patch.object(operator_setup, "report_check"),
            patch.object(operator_setup, "run_product", return_value=0),
        ):
            self.assertEqual(operator_setup.main(["run"]), 0)
        configure.assert_not_called()

    def test_keyboard_interrupt_returns_status_without_traceback(self):
        from contextlib import redirect_stderr
        from io import StringIO

        errors = StringIO()
        with (
            patch.object(operator_setup, "default_config_path", return_value=self.config_path),
            patch.object(operator_setup, "configure", side_effect=KeyboardInterrupt),
            redirect_stderr(errors),
        ):
            self.assertEqual(operator_setup.main(["run"]), 130)
        self.assertIn("operator setup interrupted", errors.getvalue())
        self.assertNotIn("Traceback", errors.getvalue())

    def test_configured_video_requires_tools_on_the_actual_run_path(self):
        config = dict(self.config, video_reference_root=str(self.temp_root / "video-refs"))
        called = []
        runner = lambda *args, **kwargs: called.append(args) or SimpleNamespace(returncode=0)
        with patch("shutil.which", return_value=None):
            with self.assertRaisesRegex(operator_setup.SetupError, "ffmpeg.*ffprobe"):
                operator_setup.run_product(self.repo, config,
                    base_environment={"PATH": "/isolated/tools"}, runner=runner)
        self.assertEqual(called, [])
        with patch("shutil.which", side_effect=lambda name, path: "/tools/" + name) as which:
            self.assertEqual(operator_setup.run_product(self.repo, config,
                base_environment={"PATH": "/isolated/tools"}, runner=runner), 0)
        self.assertEqual([call.kwargs["path"] for call in which.call_args_list],
                         ["/isolated/tools", "/isolated/tools"])
        self.assertEqual(len(called), 1)


if __name__ == "__main__":
    unittest.main()
